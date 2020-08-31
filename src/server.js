
const DEF_PORT=4096,KEY_CHARS_NUM=6,MAX_NAME_LENGTH=15,MAX_QUANTITY_DIGITS=2;
const MAX_UNLOGGED_TEXT_LENGTH=16384,MAX_LOGGED_TEXT_LENGTH=65536;

const MIN_USERNAME_LENGTH=8,MAX_USERNAME_LENGTH=15;
const MIN_PASSWORD_LENGTH=8,MAX_PASSWORD_LENGTH=25;
const MIN_EMAIL_LENGTH=10,MAX_EMAIL_LENGTH=40;

const USERNAME_EXISTS_TEXT="Username already exists!";
const NOT_VERIFIED_TEXT="Account has not been verified!";
const MAIL_RESEND_LINK_TEXT="Re-send verification mail";
const INVALID_CRED_TEXT="Incorrect username or password!";

const addresskeyPattern=`[A-Za-z0-9=$\\\+]{${KEY_CHARS_NUM}}`;
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

const persist=require("./persistence.js"),sendMail=require("./mail_sender");
const WorkersPool=require("./workers_pool"),workersPool=new WorkersPool();

passport.use("login",new Strategy(async function(username,password,handler)
{
	try
	{
		const dataObj=await persist.findUserByName(username);
		if (!dataObj) return handler(null,false,{errortext: INVALID_CRED_TEXT});
		else
		{
			const hashresult=await hashpassword(password,dataObj.salt);
			if (hashresult===dataObj.password)
			{
				if (!dataObj.verified)
				{
					return handler(null,false,
					{
						errortext: NOT_VERIFIED_TEXT,
						linktext: MAIL_RESEND_LINK_TEXT,
						link: generateResendLink(username)
					});
				}					
				else return handler(null,{username: username});
			}
			else return handler(null,false,{errortext: INVALID_CRED_TEXT});
		}
	}
	catch (error) { return handler(error); }
}));

passport.use("signup",new Strategy({ passReqToCallback: true },async function(
		request,username,password,handler)
{
	try
	{
		//TODO: e-mail uniqueness validation
		const dataObj=await persist.findUserByName(username);
		if (dataObj) 
			return handler(null,false,{errortext: USERNAME_EXISTS_TEXT});
		else
		{
			//Since a small quantity is generated, it's done synchronously
			const salt=crypto.randomBytes(16).toString("hex");
			const hashresult=await hashpassword(password,salt);
			const email=request.body.email;
			await persist.insertUser(username,email,hashresult,salt);
			try { await sendVerificationMail(email,username); }
			catch (error) { return handler(null,false,{ }); }
			return handler(null,{username: username});
		}
	}
	catch (error)
	{
		/*Might occur if a user with the same name has succeeded registering 
		  between the find and insert calls*/
		if (error instanceof persist.DataIntegrityError)
			return handler(null,false,{errortext: USERNAME_EXISTS_TEXT});
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

server.use(function(request,response,next)
{
	if ((request.session.submiterror)&&((request.path!=="/login")&&(request.
			path!=="/signup")||(request.method!=="GET")))
		delete request.session.submiterror;
	next();
});

const viewsdir=pathutils.join(__dirname,"views");
renderer.configure(viewsdir,{ autoescape: true, express: server });
server.use(express.urlencoded({extended: true}));
server.use("/",express.static(`${viewsdir}/public`));
server.use("/user",express.static(`${viewsdir}/public`));
server.use("/edit",express.static(`${viewsdir}/public`));
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
	response.render("edittext.njk.html",renderdata);
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
		minEmailLength: MIN_EMAIL_LENGTH,
		maxEmailLength: MAX_EMAIL_LENGTH,
		minPasswordLength: MIN_PASSWORD_LENGTH,
		maxPasswordLength: MAX_PASSWORD_LENGTH
	};
	if (request.session.submiterror)
		renderdata.submiterror=request.session.submiterror;
	if (signup) renderdata.signup=true;
	response.render("signlogin.njk.html",renderdata);
}

server.post("/login",function(request,response,next)
{
	const username=request.body.username,password=request.body.password;
	const message=checkCredentials(username,password);
	if (message!==null) response.status(400).send(message);
	else passport.authenticate("login",function(error,userdata,opdata)
	{
		if (error) return next(error);
		else if (!userdata)
		{
			request.session.submiterror=opdata;
			return response.redirect("/login");
		}
		else request.login(userdata,function(err)
		{
			if (err) return next(err);
			else return response.redirect("/");
		});
	})(request,response,next);
});

server.post("/signup",authenticateNewUser,handleMailSendResult);
server.get("/resend-verify",resendVerification,handleMailSendResult);

function authenticateNewUser(request,response,next)
{
	const username=request.body.username,password=request.body.password;
	let message=checkCredentials(username,password);
	if (message===null) message=checkEmailAddress(request.body.email);
	if (message!==null) response.status(400).send(message);
	else passport.authenticate("signup",function(error,userdata,opdata)
	{
		if (error) return next(error);
		else
		{
			const maildata={ username: username };
			if (!userdata)
			{
				if (opdata.errortext)
				{
					request.session.submiterror=opdata;
					return response.redirect("/signup");
				}
				else
				{
					maildata.mailsent=false; request.maildata=maildata;
					return next();
				}
			}
			else
			{ maildata.mailsent=true; request.maildata=maildata; return next(); }
		}	
	})(request,response,next);
}

function resendVerification(request,response,next)
{
	const username=request.query.username,message=checkUserName(username);
	if (message!==null) response.status(400).send(message);
	else
	{
		persist.findUserByName(username).then(function(dataObj)
		{
			if (!dataObj) response.sendStatus(404);
			else
			{
				const maildata={ username: username };
				sendVerificationMail(dataObj.email,username).
				then(() => maildata.mailsent=true).
				catch(() => maildata.mailsent=false).finally(function()
				{ request.maildata=maildata; next(); });
			}
		}).catch(error => next(error));
	}
}

function handleMailSendResult(request,response)
{
	const maildata=request.maildata; let statusData;
	if (maildata.mailsent)
	{
		statusData=
		{
			title: "Success!", linktext: "Resend mail",
			content: "Check your mail box for a verification message."
		};
	}
	else
	{
		statusData=
		{ 
			title: "Oops...", linktext: "Try again",
			content: "There was a problem sending you a verification mail."
		};
	}
	statusData.link=generateResendLink(maildata.username);
	response.render("statuspage.njk.html",statusData);
}

function generateResendLink(username)
{ return `/resend-verify?username=${username}`; }

function checkCredentials(username,password)
{
	if (!username || !password ||(username.length===0)||(password.length===0))
		return "Missing username and/or password!";
	else if ((password.length<MIN_PASSWORD_LENGTH)||(password.length>MAX_PASSWORD_LENGTH))
		return "Password is either too short or too long!";
	else return checkUserName(username);
}

function checkUserName(username)
{
	if ((username.length<MIN_USERNAME_LENGTH)||(username.length>MAX_USERNAME_LENGTH))
		return "Username is either too short or too long!";
	else if (!usernameRegExp.test(username))
	{
		return "User name contains (an) invalid character(s)! Please don't use " + 
				"spaces or special characters!";
	}
	else return null;
}

function checkEmailAddress(email)
{
	if (!email) return "Missing e-mail!";
	else if ((email.length<MIN_EMAIL_LENGTH)||(email.length>MAX_EMAIL_LENGTH))
		return "E-mail is either too short or too long!";
	else
	{
		/*To shorten the process and save time, only a basic validation is 
		  performed. The rest will be done by sending a verification mail*/
		const separatorIndex=email.indexOf("@");
		if ((separatorIndex===-1)||(email.indexOf(".",separatorIndex)===-1))
			return "Invalid e-mail!";
		else return null;
	}
}

const MAIL_TOKEN_SECRET="tainted vampire";

function sendVerificationMail(email,username)
{
	//No e-mail uniqueness requirement for now, so use only the username for encoding
	const tokenData={ username: username };
	return new Promise(function(resolve,reject)
	{
		workersPool.executeTask("generateWebToken",[tokenData,MAIL_TOKEN_SECRET,"30m"]).
		then(function(token)
		{
			const subject=`Welcome to TextShare, ${username}!`;
			const content=`<span style="font-size: larger;">
			Click <a href="https://localhost:4096/verifyuser?token=${token}">
			here</a> to verify your account.<br/>
			Enjoy sharing your texts!</span>`;
			sendMail(email,subject,"",content);
		}).then(() => resolve()).catch(error => reject(error));
	});
}

server.get("/verifyuser",async function(request,response,next)
{
	const token=request.query.token; let tokenData,handled=false;
	try
	{ 
		tokenData=await workersPool.executeTask("verifyWebToken",[token,
				MAIL_TOKEN_SECRET]);
	}
	catch(error)
	{
		if (error.name==="TokenExpiredError")
		{
			const statusData=
			{
				title: "Too late...", linktext: "Resend mail",
				content: "Your verification link has expired!",
				link: generateResendLink(error.decoded.username)
			};
			response.render("statuspage.njk.html",statusData);
		}
		else response.sendStatus(403); //Forbidden
		handled=true;
	}
	if (!handled)
	{
		persist.verifyUser(tokenData.username).then(function()
		{
			const statusData=
			{
				title: "Success!", link: "/login", linktext: "sign in",
				content: "Your account is verified! You can now "
			};
			response.render("statuspage.njk.html",statusData);
		}).catch(error => next(error));
	}
});

server.get(`/:addresskey(${addresskeyPattern})`,function(request,response,next)
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

server.delete(`/delete/:addresskey(${addresskeyPattern})`,validateTextChange,
		function(request,response,next)
{
	const addresskey=request.params.addresskey;
	persist.deleteText(addresskey).then(() => response.sendStatus(200)).
	catch(error => next(error));
});

server.get(`/edit/:addresskey(${addresskeyPattern})`,validateTextChange,
		function(request,response)
{
	const addresskey=request.params.addresskey;
	const renderdata=
	{
		maxNameLength: MAX_NAME_LENGTH, periods: renderPeriods,
		maxTextLength: MAX_LOGGED_TEXT_LENGTH, update: true,
		username: request.user.username
	};
	Object.assign(renderdata,request.textData);
	renderdata.addresskey=renderdata._id; delete renderdata._id;
	delete renderdata.creationdate; delete renderdata.expirydate;
	response.render("edittext.njk.html",renderdata);
});

function validateTextChange(request,response,next)
{
	persist.findTextByKey(request.params.addresskey).then(function(textData)
	{
		if (!textData) response.sendStatus(404);
		else if ((!textData.username)||(!request.user)||(textData.username!==
				request.user.username))
		{
			response.set("WWW-Authenticate","Form");
			response.status(401).send("You are not authorized to change " + 
					"or delete this text!");
		}
		else { request.textData=textData; next(); }
	}).catch(error => next(error));
}

server.get("/user/:username",async function(request,response,next)
{
	const username=request.params.username;
	if ((!username)||(checkUserName(username)!==null))
		return response.sendStatus(404);
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

function validateTextData(request)
{
	const textContent=request.body.text;
	if ((!textContent)||(textContent.length===0)) return "No text was sent!";
	else
	{
		const maxTextLength=((request.isAuthenticated)&&(request.isAuthenticated())?
				MAX_LOGGED_TEXT_LENGTH:MAX_UNLOGGED_TEXT_LENGTH);
		if (textContent.length>maxTextLength)
			return `You cannot share a text that's longer than ${maxTextLength}`;
	}
	const settings=new Object(),nametitle=request.body.nametitle;
	if (nametitle)
	{
		if (nametitle.length>MAX_NAME_LENGTH)
			return `The name/title cannot be longer than ${MAX_NAME_LENGTH}!`;
		else settings.nametitle=nametitle;
	}
	const format=request.body.format;
	if (format)
	{
		if ((format!=="N")&&(format!=="C")&&(format!=="B"))
			return "Invalid text format!";
		else if (format!=="N") settings.format=format;
	}	
	const expiry=request.body.expiry;
	if ((expiry)&&((expiry!=="N")&&(expiry!=="P")&&(expiry!=="R"))||((expiry==="R")&&
			(!request.path.startsWith("/update"))))
		return "Invalid expiry value!";
	else if (expiry==="P")
	{
		let quantity=request.body.quantity,period=request.body.period;
		if ((period)&&(!(period in periodsData))) return "Invalid period value!";
		else if (!period) period="m";
		if (quantity)
		{
			if (quantity.length>MAX_QUANTITY_DIGITS) 
				return "Quantity value too long!";
			else
			{
				quantity=Number.parseInt(quantity);
				if (Number.isNaN(quantity)) 
					return "Quantity value must be numeric!";
				else if (!Number.isInteger(quantity)) 
					return "Quantity value cannot be a fraction!";
				else
				{
					const maxvalue=periodsData[period].max;
					if ((quantity<1)||(quantity>maxvalue))
						return `Quantity value must be between 1 and ${maxvalue}!`;
				}
			}
		}
		else quantity=1;
		settings.quantity=quantity; settings.period=period;
	}
	return settings;
}

function updateExpiryDate(settings,expiry,reset)
{
	if (expiry==="P")
	{
		const periodData=periodsData[settings.period];
		const basetime=(reset?Date.now():settings.creationdate.getTime());
		const expirydate=new Date(basetime);
		periodData.dateset.call(expirydate,periodData.dateget.call(expirydate)+
				settings.quantity);
		settings.expirydate=expirydate;
	}
	else if ((!expiry)||(expiry==="N")) delete settings.expirydate;
}

//The patch HTTP method is not supported by HTML forms
server.post(`/update/:addresskey(${addresskeyPattern})`,validateTextChange,
		function(request,response,next)
{
	const result=validateTextData(request);
	if (typeof(result)==="string") response.status(400).send(result);
	else
	{
		const settings=result,addresskey=request.params.addresskey;
		settings.creationdate=request.textData.creationdate;
		settings.expirydate=request.textData.expirydate;
		updateExpiryDate(settings,request.body.expiry,true);
		if (settings.format==="B")
		{
			workersPool.executeTask("analyzeBlockQuote",[request.body.text]).
			then(quoteParts => Object.assign(settings,quoteParts));
		}
		persist.updateText(addresskey,request.body.text,settings).then(() => 
				response.redirect(`/${addresskey}`)).catch(error => next(error));
	}
});

server.post("/newtext",async function(request,response,next)
{
	const validationResult=validateTextData(request);
	if (typeof(validationResult)==="string")
		return response.status(400).send(validationResult);
	const newtext=request.body.text,settings=validationResult;
	settings.creationdate=new Date();
	updateExpiryDate(settings,request.body.expiry);
	if (settings.format==="B")
	{
		let quoteParts;
		try 
		{ quoteParts=await workersPool.executeTask("analyzeBlockQuote",[newtext]); }
		catch(error) { return next(error); }
		Object.assign(settings,quoteParts);
	}
	
	//Based on the algorithm suggested on https://nlogn.in/designing-a-realtime-scalable-url-shortening-service-like-tiny-url/
	const hashParams=["md5","base64",newtext]; let result;
	if ((settings.nametitle)&&(settings.nametitle.length>0))
		hashParams.push(settings.nametitle);
	if (request.user) hashParams.push(request.user.username);
	try { result=await workersPool.executeTask("hashPlainData",hashParams); }
	catch(error) { return next(error); }
	let addresskey,found=false,times=0;
	const keystartIndicesNum=result.length-KEY_CHARS_NUM+1;
	/*Have to limit the number of trials to prevent DOS attacks using the 
	  same data repeatedly*/
	while ((!found)&&(times<Math.ceil(keystartIndicesNum*0.85)))
	{
		const startIndex=Math.floor(Math.random()*keystartIndicesNum);
		//Slashes change the URL's path
		addresskey=result.substring(startIndex,startIndex+KEY_CHARS_NUM).replace("/","$");
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

const theServer=https.createServer(
{
	key: filesystem.readFileSync(pathutils.join(__dirname,"sitekey.pem")),
	cert: filesystem.readFileSync(pathutils.join(__dirname,"sitecert.pem"))
},server);

theServer.once("close",() => workersPool.shutdown());
let port=process.env.NODE_PORT; if (!port) port=DEF_PORT;
theServer.listen(port,() => console.log(`Now listening on port ${port}.`));
