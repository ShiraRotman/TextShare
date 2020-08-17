db=db.getSiblingDB("textshare")
var nowdate=Date.now()
db.stored_texts.deleteMany({expirydate: {$exists: true, $lte: nowdate}})