
const mongo=require("mongodb").MongoClient;

function connectToDB()
{ 
	return mongo.connect("mongodb://appuser:pacman@localhost:16384/textshare",
			{ useUnifiedTopology: true });
}

function findText(textkey)
{
	return new Promise(async function(resolve,reject)
	{
		try
		{
			const client=await connectToDB();
			try
			{
				const document=await client.db().collection("stored_texts").
						findOne({_id: textkey});
				resolve(document);
			}
			catch(error) { reject(error); }
			finally { client.close().catch(()=>{ })}
		}
		catch(error) { reject(error); }
	});
}

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
					const result=await collection.insertOne({_id: textkey, text: textvalue});
					if (result.insertedCount==1) resolve();
					else reject(new Error("Unexpected error! Text hasn't been inserted!"));
				}
			}
			catch(error) { reject(error); }
			finally { client.close().catch(()=>{ })}
		}
		catch(error) { reject(error); };
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
	findText: findText, insertText: insertText
};
