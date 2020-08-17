
const DEF_PORT=4096,KEY_CHARS_NUM=6,MAX_NAME_LENGTH=15,MAX_QUANTITY_DIGITS=2;
const MAX_UNLOGGED_TEXT_LENGTH=16384,MAX_LOGGED_TEXT_LENGTH=65536;
const MIN_USERNAME_LENGTH=8,MAX_USERNAME_LENGTH=15;
const MIN_PASSWORD_LENGTH=8,MAX_PASSWORD_LENGTH=25;

const LOGIN_ERROR_TEXT="Incorrect username or password!";
const SIGNUP_ERROR_TEXT="Username already exists!";

const usernamePattern="^(?:\\p{L}|\\p{M}|\\p{N}|\\p{Pd}|\\p{Pc})+$";
const usernameRegExp=new RegExp(usernamePattern,"u");
const userRenderPattern=usernamePattern.replace("\\\\","\\");

const periodsData=
{
	"m": {max: 60, dateget: Date.prototype.getMinutes, dateset: Date.prototype.setMinutes},
	"h": {max: 24, dateget: Date.prototype.getHours, dateset: Date.prototype.setHours},
	"d": {max: 31, dateget: Date.prototype.getDate, dateset: Date.prototype.setDate},
	"M": {max: 12, dateget: Date.prototype.getMonth, dateset: Date.prototype.setMonth},
	"y": {max: 5, dateget: Date.prototype.getFullYear, dateset: Date.prototype.setFullYear},
};

const renderPeriods=(function()
{
	const tempdata=[
	{value: "m", name: "Minute(s)"},{value: "h", name: "Hour(s)"},
	{value: "d", name: "Day(s)"},{value: "M", name: "Month(s)"},
	{value: "y", name: "Year(s)"}];
	
	const periods=new Array(tempdata.length);
	for (let index=0;index<tempdata.length;index++)
	{
		periods[index]=tempdata[index];
		periods[index].max=periodsData[periods[index].value].max;
	}
	return periods;
})();

const https=require("https"),crypto=require("crypto");
const filesystem=require("fs"),pathutils=require("path");
const express=require("express"),server=express();
const session=require("express-session"),renderer=require("nunjucks");
const passport=require("passport"),Strategy=require("passport-local").Strategy;
const persist=require("./persistence.js");

passport.use("login",new Strategy(async function(username,password,handler)
{
	try
	{
		const dataObj=await persist.findUserByName(username);
		if (!dataObj) return handler(null,false,{submiterror: LOGIN_ERROR_TEXT});
		else
		{
			const hashresult=await hashpassword(password,dataObj.salt);
			if (hashresult===dataObj.password)
				return handler(null,{username: username});
			else return handler(null,false,{submiterror: LOGIN_ERROR_TEXT});
		}
	}
	catch (error) { return handler(error); }
}));

passport.use("signup",new Strategy(async function(username,password,handler)
{
	try
	{
		const dataObj=await persist.findUserByName(username);
		if (dataObj) 
			return handler(null,false,{signuperror: SIGNUP_ERROR_TEXT});
		else
		{
			//Since a small quantity is generated, it's done synchronously
			const salt=crypto.randomBytes(16).toString("hex");
			const hashresult=await hashpassword(password,salt);
			await persist.insertUser(username,hashresult,salt);
			return handler(null,{username: username});
		}
	}
	catch (error)
	{
		/*Might occur if a user with the same name has succeeded registering 
		  between the find and insert calls*/
		if (error instanceof persist.DataIntegrityError)
			return handler(null,false,{signuperror: SIGNUP_ERROR_TEXT});
		else return handler(error);
	}
}));

function hashpassword(password,salt)
{
	return new Promise(function(resolve,reject)
	{
		crypto.scrypt(password,salt,32,function(error,hashresult)
		{ if (error) reject(error); else resolve(hashresult.toString("hex")); });
	});
}

passport.serializeUser(function(userdata,handler)
{ handler(null,userdata.username); });

passport.deserializeUser(function(username,handler)
{
	persist.findUserByName(username).then(function()
	{ handler(null,{username: username}); }).
	catch (function(error) { return handler(error); });
});

server.use(session(
{
	secret: "monster bash", resave: false, rolling: true, unset: "destroy",
	saveUninitialized: false, cookie: {maxAge: 1800000, secure: true} //30*60*1000
}));

const viewsdir=pathutils.join(__dirname,"views");
renderer.configure(viewsdir,{ autoescape: true, express: server });
server.use(express.urlencoded({extended: true}));
server.use("/",express.static(`${viewsdir}/public`));
server.use("/user",express.static(`${viewsdir}/public`));
server.use(passport.initialize(),passport.session());

server.get("/",function(request,response)
{
	const renderdata={ maxNameLength: MAX_NAME_LENGTH };
	if ((request.isAuthenticated)&&(request.isAuthenticated()))
	{
		renderdata.username=request.user.username;
		renderdata.maxTextLength=MAX_LOGGED_TEXT_LENGTH;
	}
	else renderdata.maxTextLength=MAX_UNLOGGED_TEXT_LENGTH;
	renderdata.periods=renderPeriods;
	response.render("newtext.njk.html",renderdata);
});

server.get("/logout",function(request,response)
{
	if (request.logout) request.logout();
	response.redirect("/");
});

server.get("/login",serveSignLogin.bind(null,false));
server.get("/signup",serveSignLogin.bind(null,true));

function serveSignLogin(signup,request,response)
{
	if ((request.isAuthenticated)&&(request.isAuthenticated())) request.logout();
	const renderdata=
	{
		usernamePattern: userRenderPattern,
		minUsernameLength: MIN_USERNAME_LENGTH,
		maxUsernameLength: MAX_USERNAME_LENGTH,
		minPasswordLength: MIN_PASSWORD_LENGTH,
		maxPasswordLength: MAX_PASSWORD_LENGTH
	};
	if (request.session.submiterror)
		renderdata.submiterror=request.session.submiterror;
	if (signup) renderdata.signup=true;
	response.render("signlogin.njk.html",renderdata);
}

server.post("/login",authenticate.bind(null,"login"));
server.post("/signup",authenticate.bind(null,"signup"));

function authenticate(strategy,request,response,next)
{
	const username=request.body.username,password=request.body.password;
	const message=checkCredentials(username,password);
	if (message!==null) response.status(400).send(message);
	else passport.authenticate(strategy,function(error,userdata,opdata)
	{
		if (error) return next(error);
		else if (!userdata)
		{
			request.session.submiterror=opdata.submiterror;
			return response.redirect(`/${strategy}`);
		}
		else request.login(userdata,function(err)
		{
			delete request.session.submiterror;
			if (err) return next(err);
			else return response.redirect("/");
		});
	})(request,response,next);
}

function checkCredentials(username,password)
{
	if (!username || !password ||(username.length===0)||(password.length===0))
		return "Missing username and/or password!";
	else if ((username.length<MIN_USERNAME_LENGTH)||(username.length>MAX_USERNAME_LENGTH))
		return "Username is either too short or too long!";
	else if ((password.length<MIN_PASSWORD_LENGTH)||(password.length>MAX_PASSWORD_LENGTH))
		return "Password is either too short or too long!";
	else if (!usernameRegExp.test(username))
	{
		return "Password contains (an) invalid character(s)! Please don't use " + 
				"spaces or special characters!";
	}
	else return null;
}

server.get(`/:addresskey([A-Za-z0-9=\\\+\\\/]{${KEY_CHARS_NUM}})`,function(request,response,next)
{
	const addresskey=request.params.addresskey;
	persist.findTextByKey(addresskey).then(function(dataObj)
	{
		if (dataObj)
		{
			//For future REST support
			const contentType=request.accepts("text/html");
			if (!contentType) response.sendStatus(406); //Not Acceptable
			else
			{
				const renderdata=dataObj;
				if (renderdata.username)
				{
					renderdata.textowner=renderdata.username;
					delete renderdata.username;
				}
				if (contentType==="text/html")
				{
					if ((request.isAuthenticated)&&(request.isAuthenticated()))
						renderdata.username=request.user.username;
					response.render("showtext.njk.html",renderdata);
				}
			}
		}
		else response.sendStatus(404);
	}).catch(next);
});

server.get(`/user/:username([^\\s\\\/]{${MIN_USERNAME_LENGTH},${MAX_USERNAME_LENGTH}})`,
		async function(request,response,next)
{
	const username=request.params.username;
	try 
	{
		const userdata=await persist.findUserByName(username);
		if (!userdata) response.sendStatus(404);
		else
		{
			const textlist=await persist.retrieveTextsForUser(username);
			for (let textitem of textlist)
			{
				textitem.addresskey=textitem._id;
				delete textitem._id;
			}
			const renderdata=
			{
				minPageRows: persist.MIN_RETRIEVAL_LIMIT,
				maxPageRows: persist.MAX_RETRIEVAL_LIMIT,
				textlist: textlist, listowner: username
			};
			if ((request.isAuthenticated)&&(request.isAuthenticated()))
				renderdata.username=request.user.username;
			response.render("listoftexts.njk.html",renderdata);
		}
	}
	catch(error) { next(error); }
});

server.post("/newtext",async function(request,response,next)
{
	const newtext=request.body.text;
	if ((!newtext)||(newtext.length===0))
		return response.status(400).send("No text was sent!");
	else
	{
		const maxTextLength=((request.isAuthenticated)&&(request.isAuthenticated())?
				MAX_LOGGED_TEXT_LENGTH:MAX_UNLOGGED_TEXT_LENGTH);
		if (newtext.length>maxTextLength)
			return response.status(400).send(`You cannot share a text that's longer than ${maxTextLength}`);
	}
	const nametitle=request.body.nametitle;
	if ((nametitle)&&(nametitle.length>MAX_NAME_LENGTH))
		return response.status(400).send(`The name/title cannot be longer than ${MAX_NAME_LENGTH}!`);
	const format=request.body.format;
	/*For supporting blockquotes, the text must be analyzed and broken into parts,
	  which might be a lengthy process and thus requires partitioning the work 
	  and optionally forcing a tighter constraint on the text's length.
	  Performing the process on the client side is unfortunately problematic due to
	  security issues. Therefore, it won't be implemented for now.*/
	if ((format)&&(format!=="N")&&(format!=="C")) //&&(format!=="B"))
		return response.status(400).send("Invalid text format!");
	const expiry=request.body.expiry;
	if ((expiry)&&(expiry!=="N")&&(expiry!=="P"))
		return response.status(400).send("Invalid expiry value!");
	else if (expiry==="P")
	{
		var quantity=request.body.quantity,period=request.body.period;
		if ((period)&&(!(period in periodsData)))
			return response.status(400).send("Invalid period value!");
		else if (!period) period="m";
		if (quantity)
		{
			if (quantity.length>MAX_QUANTITY_DIGITS)
				return response.status(400).send("Quantity value too long!");
			else
			{
				quantity=Number.parseInt(quantity);
				if (Number.isNaN(quantity))
					return response.status(400).send("Quantity value must be numeric!");
				else if (!Number.isInteger(quantity))
					return response.status("Quantity value cannot be a fraction!");
				else
				{
					const maxvalue=periodsData[period].max;
					if ((quantity<1)||(quantity>maxvalue))
						return response.status(400).send(`Quantity value must be between 1 and ${maxvalue}!`);
				}
			}
		}
		else quantity=1;
	}
	
	//Based on the algorithm suggested on https://nlogn.in/designing-a-realtime-scalable-url-shortening-service-like-tiny-url/
	const hashing=crypto.createHash("md5"); hashing.update(newtext);
	const settings=new Object();
	if ((nametitle)&&(nametitle.length>0))
	{ hashing.update(nametitle); settings.nametitle=nametitle; }
	if (request.user) hashing.update(request.user.username);
	if ((format)&&(format!=="N")) settings.format=format;
	if ((expiry)&&(expiry!=="N"))
	{
		const periodData=periodsData[period]; 
		settings.creationdate=new Date();
		const expirydate=new Date(settings.creationdate.getTime());
		periodData.dateset.call(expirydate,periodData.dateget.call(
				expirydate)+quantity); settings.expirydate=expirydate;
		settings.period=period; settings.quantity=quantity;
	}
	else settings.creationdate=new Date();
	
	//Slashes change the URL's path
	const result=hashing.digest("base64").replace("/","$");
	let addresskey,found=false,times=0;
	const keystartIndicesNum=result.length-KEY_CHARS_NUM+1;
	/*Have to limit the number of trials to prevent DOS attacks using the 
	  same data repeatedly*/
	while ((!found)&&(times<Math.ceil(keystartIndicesNum*0.85)))
	{
		const startIndex=Math.floor(Math.random()*keystartIndicesNum);
		addresskey=result.substring(startIndex,startIndex+KEY_CHARS_NUM);
		try 
		{ 
			await persist.insertText(addresskey,newtext,settings,(request.
					user)?request.user.username:null);
			found=true;
		}
		catch(error) //If key already exists, choose another one
		{ 
			if (!(error instanceof persist.DataIntegrityError)) next(error);
			else times++;
		}
	}
	if (found) response.redirect(`/${addresskey}`);
	else next(new Error("Could not store the text!!!"));
});

let port=process.env.NODE_PORT; if (!port) port=DEF_PORT;
https.createServer(
{
	key: filesystem.readFileSync(pathutils.join(__dirname,"sitekey.pem")),
	cert: filesystem.readFileSync(pathutils.join(__dirname,"sitecert.pem"))
},server).listen(port,function() { console.log(`Now listening on port ${port}.`); });
