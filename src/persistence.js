
const mongo=require("mongodb");

function connectToDB()
{ 
	return mongo.MongoClient.connect("mongodb://appuser:pacman@localhost:16384/textshare",
			{ useUnifiedTopology: true });
}

function findDocument(collection,dockey)
{
	return new Promise(async function(resolve,reject)
	{
		try
		{
			const client=await connectToDB();
			try
			{
				const document=await client.db().collection(collection).
						findOne({_id: dockey});
				resolve(document);
			}
			finally { client.close().catch(()=>{ }); }
		}
		catch(error) { reject(error); }
	});
}

function findUser(username) { return findDocument("users",username); }
function findText(textkey) { return findDocument("stored_texts",textkey); }

function retrieveTexts(username)
{
	return new Promise(async function(resolve,reject)
	{
		try
		{
			const client=await connectToDB();
			try
			{
				const cursor=client.db().collection("stored_texts").find(
				{username: username},
				{
					sort: {creationdate: -1}, hint: "texts_by_user_and_date",
					projection: {_id: 1, nametitle: 1, creationdate: 1, expirydate: 1}
				});
				let documents;
				try { documents=await cursor.toArray(); resolve(documents); }
				finally { cursor.close().catch(()=>{ }); }
			}
			finally { client.close().catch(()=>{ }); }
		}
		catch(error) { reject(error); }
	});
}

//Not used for now unfortunately
const MIN_LIMIT=10,MAX_LIMIT=25;
function retrieveTextsByRange(username,maxdate,limit,backwards)
{
	if (!limit) limit=MIN_LIMIT;
	else if ((limit<MIN_LIMIT)||(limit>MAX_LIMIT))
		throw new RangeError(`The limit on the number of documents to retrieve must be between ${MIN_LIMIT} and ${MAX_LIMIT}!`);
	if (!maxdate) maxdate=(backwards?0:Date.now());
	else if (maxdate instanceof Date) maxdate=maxdate.getTime();
	const condition=(backwards?{$gt: maxdate}:{$lt: maxdate});
	
	return new Promise(async function(resolve,reject)
	{
		try
		{
			const client=await connectToDB();
			try
			{
				const cursor=client.db().collection("stored_texts").find(
				{username: username, creationdate: condition},
				{
					limit: limit, sort: {creationdate: -1},
					projection: {_id: 1, nametitle: 1, creationdate: 1, expirydate: 1},
					hint: "texts_by_user_and_date"
				});
				let documents;
				try { documents=await cursor.toArray(); resolve(documents); }
				finally { cursor.close().catch(()=>{ }); }
			}
			finally { client.close().catch(()=>{ }); }
		}
		catch(error) { reject(error); }
	});
}

function insertText(textkey,textvalue,settings,username)
{
	return new Promise(async function(resolve,reject)
	{
		try
		{
			const client=await connectToDB();
			const collection=client.db().collection("stored_texts");
			try
			{
				let document=await collection.findOne({_id: textkey});
				if (document)
					reject(new DataIntegrityError(`Primary key already exists (${textkey})!`));
				else
				{
					document={_id: textkey, text: textvalue};
					Object.assign(document,settings);
					for (let prop in document)
					{
						const value=document[prop];
						if (value instanceof Date)
							document[prop]=mongo.Long.fromNumber(value.getTime());
					}
					if (username) document.username=username;
					const result=await collection.insertOne(document);
					if (result.insertedCount===1) resolve();
					else reject(new Error("Unexpected error! Text hasn't been inserted!"));
				}
			}
			finally { client.close().catch(()=>{ }); }
		}
		catch(error) { reject(error); };
	});
}

function insertUser(username,password,salt)
{
	return new Promise(async function(resolve,reject)
	{
		try
		{
			const client=await connectToDB();
			const collection=client.db().collection("users");
			try
			{
				const document=await collection.findOne({_id: username});
				if (document)
					reject(new DataIntegrityError("User already exists!"));
				else
				{
					const result=await collection.insertOne(
					{_id: username, password: password, salt: salt });
					if (result.insertedCount===1) resolve();
					else reject(new Error("Unexpected error! User hasn't been added!"));
				}
			}
			finally { client.close().catch(()=>{ }); }
		}
		catch(error) { reject(error); }
	});
}

function DataIntegrityError(message)
{ Error.call(this,message); }

DataIntegrityError.prototype=Object.create(Error.prototype);
DataIntegrityError.prototype.constructor=DataIntegrityError;
DataIntegrityError.prototype.name="DataIntegrityError";

module.exports=
{
	DataIntegrityError: DataIntegrityError,
	findUserByName: findUser, insertUser: insertUser,
	findTextByKey: findText, insertText: insertText,
	retrieveTextsForUser: retrieveTexts,
	MIN_RETRIEVAL_LIMIT: MIN_LIMIT, MAX_RETRIEVAL_LIMIT: MAX_LIMIT
};
