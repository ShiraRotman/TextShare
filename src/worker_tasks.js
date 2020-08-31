
const {parentPort}=require("worker_threads");
const crypto=require("crypto"),tokens=require("jsonwebtoken");
const tasksMap=
{ hashPlainData, analyzeBlockQuote, generateWebToken, verifyWebToken };

parentPort.on("message",function(taskData)
{
	const taskFunc=tasksMap[taskData.taskname];
	if (taskFunc===undefined)
		parentPort.postMessage(new RangeError(`Unrecognized task: ${taskData.taskname}!`));
	else
	{
		try { taskFunc(...taskData.params); }
		catch(error) { parentPort.postMessage(error); }
	}
});

function hashPlainData(algorithm,encoding,...data)
{
	if ((typeof(algorithm)!=="string")||(typeof(encoding)!=="string"))
		throw new TypeError("The algorithm and encoding must be strings!");
	const hashing=crypto.createHash(algorithm);
	for (let datum of data) hashing.update(datum);
	parentPort.postMessage(hashing.digest(encoding));
}

function generateWebToken(data,secret,expiration)
{
	if (typeof(data)!=="object") data={ data: data };
	const token=tokens.sign(data,secret,{ expiresIn: expiration });
	parentPort.postMessage(token);
}

function verifyWebToken(token,secret,nonce)
{
	const options={ }; let tokenData;
	if (nonce) options.nonce=nonce;
	try { tokenData=tokens.verify(token,secret,options); }
	catch(error)
	{
		if (error instanceof tokens.TokenExpiredError)
			error.decoded=tokens.decode(token);
		throw error;
	}
	parentPort.postMessage(tokenData);
}

function analyzeBlockQuote(blockquote)
{
	if (typeof(blockquote)!=="string")
		throw new TypeError("The block quote to analyze must be a string!");
	const quoteParts=new Object();
	let quoteIndex=blockquote.lastIndexOf("-");
	if (quoteIndex>-1)
	{
		//Omit the hyphen since it will be auto-added by styling
		quoteParts.quote=blockquote.substring(0,quoteIndex++);
		let separatorIndex=blockquote.indexOf(" in ",quoteIndex);
		if (separatorIndex>-1)
		{
			separatorIndex+=4; //" in ".length
			quoteParts.persona=blockquote.substring(quoteIndex,separatorIndex);
			quoteParts.source=blockquote.substring(separatorIndex);
		}
		else quoteParts.persona=blockquote.substring(quoteIndex);
	}
	else quoteParts.quote=blockquote;
	parentPort.postMessage(quoteParts);
}
