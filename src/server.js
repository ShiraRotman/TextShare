
const PORT=3000,MAX_TEXT_LENGTH=1024,KEY_CHARS_NUM=6;
const mappings=new Object();

const crypto=require("crypto"),path=require("path");
const express=require("express"),server=express();
server.use(express.json(),express.urlencoded({extended: true}));
server.use("/",express.static(path.join(__dirname,"files")));

server.get("/",function(request,response) 
{ response.redirect("/newtext.html"); });

server.get(`/:addresskey([A-Za-z0-9\\\+\\\/]{${KEY_CHARS_NUM}})`,function(request,response)
{
	const addresskey=request.params.addresskey;
	//TODO: Switch to a DB
	if (addresskey in mappings) response.status(200).send(mappings[addresskey]);
	else response.sendStatus(404);
});

server.post("/newtext",function(request,response)
{
	let newtext=request.body.text;
	if (typeof(newtext)!=="string") newtext=newtext.toString();
	//Bad Request status code (missing data)
	if (newtext.length==0) response.status(400).send("No text was sent!");
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
			if (!(addresskey in mappings))
			{ mappings[addresskey]=newtext; found=true; }
		}
		response.redirect(`/${addresskey}`);
	}
});

server.listen(PORT,function() { console.log(`Now listening on port ${PORT}.`); });
