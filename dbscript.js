db=db.getSiblingDB("textshare")
db.createCollection("stored_texts")

db.createRole(
{ 
	role: "approle",
	privileges:
	[{
		resource: { db: "textshare", collection: "stored_texts"},
		actions: ["find","insert","update","remove"]
	}], 
	roles: [], 
	authenticationRestrictions: [{ serverAddress: ["127.0.0.1"]}]
})

db.createUser({user: "appuser", pwd: "pacman", roles: ["approle"]})
db.createCollection("users")

db.grantPrivilegesToRole("approle",
[{ 
	resource: { db: "textshare", collection: "users"},
	actions: ["find"]
}])

db.grantPrivilegesToRole("approle",
[{
	resource: { db: "textshare", collection: "users"},
	actions: ["insert"]
}])

db.stored_texts.createIndex({username: 1, creationdate: -1},
{
	name: "texts_by_user_and_date", unique: true,
	partialFilterExpression: {username: {$exists: true}}
})

db.grantPrivilegesToRole("approle",
[{
	resource: { db: "textshare", collection: "users" },
	actions: ["update"]
}])
