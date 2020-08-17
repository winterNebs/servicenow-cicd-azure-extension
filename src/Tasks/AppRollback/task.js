const APIService = require('./ServiceNowCICDRestAPIService');

let API, pipeline;
module.exports = {
    init:(_pipeline, transport) =>{
        pipeline = _pipeline;
        API = new APIService(pipeline.url(), pipeline.auth(), transport);
    },
    run: () => {
        let options = {};
        'scope sys_id version'
            .split(' ')
            .forEach(name=> {
                const val = pipeline.get(name);
                if(val) {
                    options[name] = val;
                }
            });
        if(!options.version) { // try to get envvar
            options.version = pipeline.getVar('ServiceNow-CICD-App-Install.rollbackVersion');
        }
        if(!options.version) { // try to get envvar
            options.version = pipeline.getVar('rollbackVersion');
        }
        const forceRollback = pipeline.get('autodetectVersion') === 'yes';
        if(!options.version && forceRollback) { //
            options.version = '9999.9999.9999';
        }
        return API
            .appRepoRollback(options, forceRollback)
            .then(function (status) {
                console.log('\x1b[32mSuccess\x1b[0m\n');
                console.log('Rollback version is: ' + status)
            })
            .catch(err=>{
                if(err.indexOf('Expected rollback version does not match target: ') === 0) {

                }
                console.error('\x1b[31mInstallation failed\x1b[0m\n');
                console.error('The error is:', err);
                return Promise.reject();
            })
    }
}