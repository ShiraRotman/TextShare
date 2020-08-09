
const mongo=require("mongodb").MongoClient;

function connectToDB()
{ 
	return mongo.connect("mongodb://appuser:pacman@localhost:16384/textshare",
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
			catch(error) { reject(error); }
			finally { client.close().catch(()=>{ })}
		}
		catch(error) { reject(error); }
	});
}

function findUser(username) { return findDocument("users",username); }
function findText(textkey) { return findDocument("stored_texts",textkey); }

//TODO: Support more fields as a textdata argument
function insertText(textkey,textvalue)
{
	return new Promise(async function(resolve,reject)
	{
		try
		{
			const client=await connectToDB();
			const collection=client.db().collection("stored_texts");
			try
			{
				const document=await collection.findOne({_id: textkey});
				if (document)
					reject(new DataIntegrityError(`Primary key already exists (${textkey})!`));
				else
				{
					const result=await collection.insertOne(
					{_id: textkey, text: textvalue});
					if (result.insertedCount===1) resolve();
					else reject(new Error("Unexpected error! Text hasn't been inserted!"));
				}
			}
			catch(error) { reject(error); }
			finally { client.close().catch(()=>{ })}
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
			catch(error) { reject(error); }
			finally { client.close().catch(()=>{ })}
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
	findTextByKey: findText, insertText: insertText
};
