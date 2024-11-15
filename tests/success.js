const ma = require('azure-pipelines-task-lib/mock-answer');
const tmrm = require('azure-pipelines-task-lib/mock-run');
const path = require('path');
const author = process.env.AUTHOR_URL || "cicdazureappauthor.service-now.com";
const client = process.env.CLIENT_URL || "cicdazureappclient.service-now.com";
const scope = process.env.SCOPE || "x_sofse_cicdazurea";
const plugin = process.env.PLUGIN || "com.servicenow_now_calendar";
const failSuite = process.env.FAIL_ID || "73159102db125010022240ceaa961937";

/*
let taskPath = path.join(__dirname, '..', 'out', 'Tasks', 'AppPublish', 'index.js');
let tmr = new tmrm.TaskMockRunner(taskPath);

tmr.setInput('scope',scope) ;
tmr.setInput('versionFormat','detect') ;
tmr.setInput('incrementBy',1) ;

console.log(taskPath);
tmr.run();*/

let taskPath = path.join(__dirname, '..', 'out', 'Tasks', 'TestRun', 'index.js');
let tmr = new tmrm.TaskMockRunner(taskPath);

tmr.setInput('testSuiteSysId','0a383a65532023008cd9ddeeff7b1258') ;
tmr.setInput('browserName','any') ;

console.log(taskPath);
tmr.run();
