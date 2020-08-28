
const {parentPort}=require("worker_threads"),crypto=require("crypto");
const tasksMap={ hashPlainData: hashPlainData };

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
