
const {Worker}=require("worker_threads"),opersys=require("os");
const workerFilePath=require("path").join(__dirname,"worker_tasks.js");
const taskDataID=Symbol("taskData"),privatePropsMap=new WeakMap();

function WorkersPool(numWorkers)
{
	if (!numWorkers)
	{
		numWorkers=opersys.cpus().length-1; //1 for the main thread
		if (numWorkers===0) numWorkers=1;
	}
	else if (typeof(numWorkers)!=="number")
		throw new TypeError("The number of workers must be numeric!");
	else if (numWorkers<=0)
		throw new RangeError("The number of workers must be positive!");
	
	const privateProps={ maxWorkers: numWorkers };
	//TODO: Add creation policy and keep alive parameters
	privateProps.allWorkers=new Array(0);
	privateProps.freeWorkers=new Array(0);
	//TODO: Add a queue parameter and require add / remove functions
	privateProps.taskQueue=new LinkedList(); 
	privateProps.isShutdown=false;
	privatePropsMap.set(this,privateProps);
}

WorkersPool.prototype.executeTask=function(taskname,params)
{
	const privateProps=privatePropsMap.get(this);
	if (privateProps.isShutdown)
		throw new Error("The pool has already been shut down!");
	else if (!taskname)
		throw new ReferenceError("The task's name is mandatory!");
	else if (typeof(taskname)!=="string")
		throw new TypeError("The task's name must be a string!");
	else if ((params)&&(!Array.isArray(params)))
		throw new TypeError("The task's parameters must be in an array!");
	
	const taskData={ taskname: taskname, params: params }; let worker=null;
	if (privateProps.freeWorkers.length===0)
	{
		if (privateProps.allWorkers.length<privateProps.maxWorkers)
			worker=createNewWorker.call(this);
		else privateProps.taskQueue.addFirst(taskData);
	}
	else worker=privateProps.freeWorkers.pop();
	if (worker!==null) assignTask.call(this,worker,taskData);
	
	return new Promise(function(resolve,reject)
	{ 
		const generator=wait(resolve,reject); generator.next();
		this.controller=generator;
	}.bind(taskData));
}

function taskworkFinished(worker,result)
{
	let taskData=worker[taskDataID];
	if (result instanceof Error) taskData.controller.throw(result);
	else taskData.controller.next(result);
	const privateProps=privatePropsMap.get(this);
	taskData=privateProps.taskQueue.removeLast();
	if (taskData!==null) assignTask.call(this,worker,taskData);
	else 
	{ 
		worker[taskDataID]=null; 
		privateProps.freeWorkers.push(worker);
	}
}

function workerErrOccurred(worker,error)
{
	const privateProps=privatePropsMap.get(this);
	//It's an O(n) operation, but it's performed only for unexpected errors
	privateProps.allWorkers.splice(privateProps.allWorkers.indexOf(worker),1);
	const taskData=worker[taskDataID];
	if (taskData!==null) taskData.controller.throw(error);
	privateProps.freeWorkers.push(createNewWorker.call(this));
}

function createNewWorker()
{
	const worker=new Worker(workerFilePath); worker[taskDataID]=null;
	privatePropsMap.get(this).allWorkers.push(worker);
	worker.once("error",workerErrOccurred.bind(this,worker));
	return worker;
}

function assignTask(worker,taskData)
{
	worker[taskDataID]=taskData;
	worker.once("message",taskworkFinished.bind(this,worker));
	worker.postMessage({ taskname: taskData.taskname, params: taskData.params });
}

function* wait(resolve,reject)
{
	try { const result=yield undefined; resolve(result); }
	catch(error) { reject(error); }
}

WorkersPool.prototype.shutdown=function()
{
	const privateProps=privatePropsMap.get(this);
	for (let worker of privateProps.allWorkers)
	{
		worker.terminate(); const taskData=worker[taskDataID];
		if (taskData!==null)
			taskData.controller.throw(new Error("Task terminated!"));
	}
	privateProps.isShutdown=true;
}

module.exports=WorkersPool;

//This partial implementation can intentionally be directly manipulated
function LinkedList() { this.first=null; this.last=null; }

LinkedList.prototype.addFirst=function(elem)
{
	const connector={ elem: elem, prev: null };
	if (this.first===null)
	{ this.first=connector; this.last=connector; connector.next=null; }
	else
	{ connector.next=this.first; this.first.prev=connector; this.first=connector; }
}

LinkedList.prototype.removeLast=function()
{
	if (this.last===null) return null;
	else
	{
		const elem=this.last.elem; this.last=this.last.prev;
		if (this.last!==null) this.last.next=null; else this.first=null;
		return elem;
	}
}
