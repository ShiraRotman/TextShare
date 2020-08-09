
const DEF_PORT=4096,MAX_TEXT_LENGTH=1024,KEY_CHARS_NUM=6;
const MIN_USERNAME_LENGTH=8,MAX_USERNAME_LENGTH=15;
const MIN_PASSWORD_LENGTH=8,MAX_PASSWORD_LENGTH=25;
const LOGIN_ERROR_TEXT="Incorrect username or password!";
const SIGNUP_ERROR_TEXT="Username already exists!";

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

passport.deserializeUser(async function(username,handler)
{
	try
	{
		const dataObj=await persist.findUserByName(username);
		handler(null,{username: username});
	}
	catch (error) { return handler(error); }
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
server.use(passport.initialize(),passport.session());

server.get("/",function(request,response) 
{
	const renderdata={maxlength: MAX_TEXT_LENGTH};
	if ((request.isAuthenticated)&&(request.isAuthenticated()))
		renderdata.username=request.user.username;
	response.render("newtext.njk.html",renderdata);
});

server.get("/login",serveSignLogin.bind(null,false));
server.get("/signup",serveSignLogin.bind(null,true));

function serveSignLogin(signup,request,response)
{
	if ((request.isAuthenticated)&&(request.isAuthenticated())) request.logout();
	const renderdata=
	{
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
	//Bad Request status code (domain validation errors)
	if ((!newtext)||(newtext.length===0)) 
		response.status(400).send("No text was sent!");
	else if (newtext.length>MAX_TEXT_LENGTH)
		response.status(400).send(`You cannot share a text that's longer than ${MAX_TEXT_LENGTH}!`);
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

let port=process.env.NODE_PORT; if (!port) port=DEF_PORT;
https.createServer(
{
	key: filesystem.readFileSync(pathutils.join(__dirname,"sitekey.pem")),
	cert: filesystem.readFileSync(pathutils.join(__dirname,"sitecert.pem"))
},server).listen(port,function() { console.log(`Now listening on port ${port}.`); });
