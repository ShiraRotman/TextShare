use textshare
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