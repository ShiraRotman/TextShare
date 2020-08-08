
const PORT=4096,MAX_TEXT_LENGTH=1024,KEY_CHARS_NUM=6;

const crypto=require("crypto"),path=require("path");
const express=require("express"),server=express();
const renderer=require("nunjucks");
const persist=require("./persistence.js");

const viewsdir=path.join(__dirname,"views");
renderer.configure(viewsdir,{ autoescape: true, express: server });
server.use(express.json(),express.urlencoded({extended: true}));
server.use("/",express.static(`${viewsdir}/public`));

server.get("/",function(request,response) 
{ response.render("newtext.njk.html",{maxlength: MAX_TEXT_LENGTH}); });

server.get(`/:addresskey([A-Za-z0-9=\\\+\\\/]{${KEY_CHARS_NUM}})`,function(request,response,next)
{
	const addresskey=request.params.addresskey;
	persist.findText(addresskey).then(function(dataObj)
	{
		if (dataObj)
		{
			//For future REST support
			const contentType=request.accepts("text/html");
			if (!contentType) response.sendStatus(406); //Not Acceptable
			else
			{
				const result={text: dataObj.text};
				if (contentType==="text/html") 
					response.render("showtext.njk.html",result);
			}
		}
		else response.sendStatus(404);
	}).catch(next);
});

server.post("/newtext",async function(request,response,next)
{
	let newtext=request.body.text;
	if (typeof(newtext)!=="string") newtext=newtext.toString();
	//Bad Request status code (missing data)
	if (newtext.length===0) response.status(400).send("No text was sent!");
	else if (newtext.length>MAX_TEXT_LENGTH)
		//Request Entity too Long status code
		response.status(413).send(`You cannot share a text that's longer than ${MAX_TEXT_LENGTH}!`);
	else
	{
		//Based on the algorithm suggested on https://nlogn.in/designing-a-realtime-scalable-url-shortening-service-like-tiny-url/
		const hashing=crypto.createHash("md5");
		hashing.update(newtext);
		const result=hashing.digest("base64");
		let addresskey,found=false;
		while (!found)
		{
			const startIndex=Math.floor(Math.random()*(result.length-KEY_CHARS_NUM+1));
			addresskey=result.substring(startIndex,startIndex+KEY_CHARS_NUM);
			try { await persist.insertText(addresskey,newtext); found=true; }
			catch(error) //If key already exists, choose another one
			{ if (!(error instanceof persist.DataIntegrityError)) next(error); }
		}
		response.redirect(`/${addresskey}`);
	}
});

server.listen(PORT,function() { console.log(`Now listening on port ${PORT}.`); });
