﻿const https = require('https');
const URL = require('url');
const respError = function(error, response) {
    this.errorMessage = error;
    this.response = response;
};

/**
 *
 * @param instance string Domain name of instance
 * @param auth string username:password
 * @param transport default is https, and can be changed to mocks
 * @constructor
 */
function ServiceNowCICDRestAPIService(instance, auth, transport = null) {
    if (typeof instance !== 'string' || instance.length < 3) {
        throw new Error(`Instance is not valid: "${instance}"`);
    }
    if (
        typeof auth !== 'string' ||
        auth.length < 3 ||
        auth.indexOf(':') < 1
    ) {
        throw new Error('Incorrect auth');
    }
    instance = instance.replace(/(^\https:|^)\/\//, '').replace(/^\/|\/$/g, '');
    /* Replaced the regular expression so that if the instance URL contains extra parameters those can be used.
    instance = instance.replace(/(?:^https?:\/\/)?([^\/]+)(?:\/.*$)/, '$1');
    */
    if (!instance.length) {
        throw new Error('Incorrect instance');
    }

    const config = {
        instance,
        auth,
        delayInProgressPolling: 3000
    };
    const errCodeMessages = {
        401: 'The user credentials are incorrect.',
        403: 'Forbidden. The user is not an admin or does not have the CICD role.',
        404: 'Not found. The requested item was not found.',
        405: 'Invalid method. The functionality is disabled.',
        409: 'Conflict. The requested item is not unique.',
        500: 'Internal server error. An unexpected error occurred while processing the request.'
    };

    this.activatePlugin = activatePlugin;
    this.deActivatePlugin = deactivatePlugin;
    // this.getTSResults = getTSResults;
    this.testSuiteRun = testSuiteRun;
    this.appRepoInstall = appRepoInstall;
    this.appRepoRollback = appRepoRollback;
    this.appRepoPublish = appRepoPublish;
    this.SCApplyChanges = SCApplyChanges;
    this.scanInstance = scanInstance;
    this.batchInstall = batchInstall;

    /**
     * Activate plugin by its ID
     * @param id string
     * @returns {Promise<string>}
     */
    function activatePlugin(id) {
        const URL = 'plugin/' + id + '/activate';
        return request(URL, false, 'POST')
            .then(resp => getProgress(resp))
            .catch(err => Promise.reject(err.errorMessage))
            .then(resp => resp.status_message);
    }

    /**
     * Deactivate plugin by its ID
     * @param id string
     * @returns {Promise<string>}
     */
    function deactivatePlugin(id) {
        const URL = 'plugin/' + id + '/rollback';
        return request(URL, false, 'POST')
            .then(resp => getProgress(resp))
            .catch(err => Promise.reject(err.errorMessage))
            .then(resp => resp.status_message);
    }

    /**
     * Get TestSuite run results by ID
     * @param resultID string
     * @returns {Promise<string>}
     */
    function getTSResults(resultID) {
        const URL = 'testsuite/results/' + resultID;
        return request(URL)
            .catch(err => Promise.reject(err.errorMessage));
    }

    /**
     * Run Test Suite
     * available options are:
     * test_suite_sys_id, test_suite_name, browser_name, browser_version, os_name os_version
     * required options are:
     * test_suite_sys_id|test_suite_name
     * @param options object
     * @returns {Promise<object>}
     */

    function testSuiteRun(options) {
        if (!options || !(options.test_suite_sys_id || options.test_suite_name)) {
            return Promise.reject('Please specify test_suite_name or test_suite_sys_id');
        }
        if (options.test_suite_sys_id && options.test_suite_name) {
            delete options.test_suite_name;
        }
        return request(
            'testsuite/run',
            { fields: 'test_suite_sys_id test_suite_name browser_name browser_version os_name os_version', options },
            'POST')
            .then(resp => getProgress(resp))
            .catch(err => (err.response.results && err.response.results.id) ?
                err.response : Promise.reject(err.errorMessage))
            .then(resp => getPropertyByPath(resp, 'results.id'))
            .then(resultID => resultID ? getTSResults(resultID) : Promise.reject('No result ID'));
    }

    /**
     * Scan instance, available options are:
     * full, point, suiteCombo, suiteScoped, suiteUpdate
     * 
     * @param url       string
     * @param options   object
     * @param payload   string
     * @returns {Promise<string>} If available, the previously installed version. If not available, null.
     */
    function scanInstance(url, options, payload = '') {
        return request(url, { fields: 'target_table target_sys_id', options }, 'POST', payload)
            .then(resp => getProgress(resp, true))
            .catch(err => Promise.reject(err.errorMessage));
    }

    /**
     * Batch Install. Payload could be obtained from repo file or workflow definition.
     * 
     * @param url       string
     * @param payload   string
     * @returns {Promise<string>} If available, the previously installed version. If not available, null.
     */
    function batchInstall(url, payload) {
        return request(url, false, 'POST', payload)
            .then(resp => getProgress(resp))
            .then(resp => {
                const progressUrl = resp.links.progress.url;
                const resultsUrl = resp.links.results.url;
                const rollbackUrl = resp.links.rollback.url;
                request(progressUrl).then(response => {
                    if (response.status_message) {
                        console.log('Status is: ' + response.status_message);
                        return response.status_message;
                    }
                });
                extractBatchResults(resultsUrl).then(msg => msg && console.log("Status messages:", msg));

                return rollbackUrl;
            })
            .catch(errObj => {
                try {
                    const resultsUrl = errObj.response.results.url;
                    extractBatchResults(resultsUrl).then(msg => msg && console.log("Status messages:", msg));
                    return Promise.reject(errObj.errorMessage);
                } catch (error) {
                    return Promise.reject();
                }
            });
    }

    /**
     * Extract batch install verbose messages
     * 
     * @param url   string
     * @returns     string
     */
    function extractBatchResults(url) {
        return url && request(url).then((resp) => {
            let msg = '';
            resp.batch_items.forEach((item) => {
                msg += `\n${item.name}: ${item.state}. ${item.status_message}`;
            });

            return msg;
        }).catch(err => { console.log(err) });
    }

    /**
     * Scan instance, available options are:
     * full, point, suiteCombo, suiteScoped, suiteUpdate
     * 
     * @param url       string
     * @param options   object
     * @param payload   array
     * @returns {Promise<string>} If available, the previously installed version. If not available, null.
     */
    function scanInstance(url, options, payload = '') {
        return request(url, { fields: 'target_table target_sys_id', options }, 'POST', payload)
            .then(resp => getProgress(resp, true))
            .catch(err => Promise.reject(err.errorMessage))
    }

    /**
     * Install the specified application from the application repository onto the local instance
     * available options are:
     * scope, sys_id, version, auto_upgrade_base_app, base_app_version
     * 
     * required options are:
     * scope|sys_id
     * @param options
     * @returns {Promise<string>} If available, the previously installed version. If not available, null.
     */
    function appRepoInstall(options) {
        if (!options || !(options.scope || options.sys_id)) {
            return Promise.reject('Please specify scope or sys_id');
        }
        if (options.scope && options.sys_id) {
            delete options.scope;
        }
        return request('app_repo/install', { fields: 'sys_id scope version auto_upgrade_base_app base_app_version', options }, 'POST')
            .then(resp => getProgress(resp))
            .catch(err => Promise.reject(err.errorMessage))
            .then(resp => {
                return resp.rollback_version || (resp.results && resp.results.rollback_version);
            });
    }

    /**
     * Initiate a rollback of a specified application to a specified version
     * available options are:
     * scope, sys_id, version
     * required options are:
     * scope|sys_id, version
     * @param options
     * @returns {Promise<object>}
     */
    function appRepoRollback(options, forceRollback = false) {
        if (!options || !(options.scope || options.sys_id) || !options.version) {
            return Promise.reject('Please specify scope or sys_id, and version');
        }
        if (options.scope && options.sys_id) {
            delete options.scope;
        }
        return request('app_repo/rollback', { fields: 'sys_id scope version', options }, 'POST')
            .catch(err => {
                if (forceRollback && err.errorMessage.indexOf('Expected rollback version does not match target: ') === 0) {
                    options.version = err.errorMessage.substr(49);
                    return request('app_repo/rollback', { fields: 'sys_id scope version', options }, 'POST');
                } else {
                    return Promise.reject(err);
                }
            })
            .then(resp => getProgress(resp))
            .then(() => options.version)
            .catch(err => Promise.reject(err.errorMessage));
    }

    /**
     * Publish the specified application and all of its artifacts to the application repository
     * available options are:
     * scope, sys_id, version, dev_notes
     * required options are:
     * scope|sys_id
     * @param options
     * @returns {Promise<string>}
     */
    function appRepoPublish(options) {
        if (!options || !(options.scope || options.sys_id)) {
            return Promise.reject('Please specify scope or sys_id');
        }

        if (!options || (options.is_app_customization && !options.sys_id)) {
            return Promise.reject('Sys_id is not defined, while is_app_customization is checked.');
        }

        if (options.scope && options.sys_id) {
            delete options.scope;
        }
        let promise = Promise.resolve();
        if (!options.version && options.autodetect) {
            let increment;
            if (+options.increment_by < 0) {
                return Promise.reject('Increment_by should be positive or zero.');
            } else {
                increment = options.increment_by ? +options.increment_by : 0;
            }
            promise = getCurrentApplicationVersion(options).then(version => {
                if (version) {
                    version = version.split('.');
                    version[2] = +version[2] + increment;
                    version = version.join('.');
                    options.version = version;
                } else {
                    return Promise.reject('Can\'t autodetect version number.');
                }
            });
        }
        return promise.then(() => request('app_repo/publish', {
            fields: 'sys_id scope version dev_notes',
            options
        }, 'POST')
            .then(resp => getProgress(resp))
            .catch(err => Promise.reject(err.errorMessage))
            .then(() => options.version));
    }

    /**
     * Start applying changes from a remote source control to a specified local application.
     * available options are:
     * app_scope, app_sys_id, branch_name
     * required options are:
     * app_scope|app_sys_id
     * @param options object
     * @returns {Promise<object>}
     */
    function SCApplyChanges(options) {
        if (!options || !(options.app_scope || options.app_sys_id)) {
            return Promise.reject('Please specify app_scope or app_sys_id');
        }
        if (options.app_scope && options.app_sys_id) {
            delete options.app_scope;
        }
        return request('sc/apply_changes', { fields: 'app_sys_id app_scope branch_name', options }, 'POST')
            .then(resp => getProgress(resp))
            .catch(err => Promise.reject(err.errorMessage));
    }

    ///////////////////////////////////////////////////////////////////////////////

    /**
     * Async wait
     * @param ms
     * @returns {Promise<unknown>}
     */
    function wait(ms) {
        return new Promise(a => setTimeout(() => a(), ms));
    }

    /**
     * Wait until progress resolves and return result or reject on error.
     * @param response object
     * @param returnProgress bool
     * @returns {Promise<string>|<object>}
     */

    function getProgress(response, returnProgress = false) {
        let status = +response.status;
        const progressId = getPropertyByPath(response, 'links.progress.id');
        if (progressId && (status === 0 || status === 1)) {
            const progressUrl = 'progress/' + progressId;
            return request(progressUrl)
                .then(progressBody => {
                    status = +progressBody.status;
                    if (status >= 2) {
                        process.stdout.write('\n');
                        response.results = getPropertyByPath(progressBody, 'links.results');
                        if (status === 2) {
                            return Promise.resolve(returnProgress ? progressBody : response);
                        } else {
                            progressBody.results = response.results || getPropertyByPath(response, 'links.results');
                            return Promise.reject(new respError(progressBody.error || progressBody.status_message, progressBody));
                        }
                    } else {
                        if (status === 1) {
                            const percentage = getPropertyByPath(progressBody, 'percent_complete');
                            if (percentage) {
                                process.stdout.write(`${percentage}% complete`);
                            }
                        }
                        process.stdout.write('.\n');

                        return wait(config.delayInProgressPolling).then(() => getProgress(response, returnProgress));
                    }
                });
        } else {
            return status === 2 ?
                Promise.resolve(response) :
                Promise.reject(new respError(response.error || response.status_message, response));
        }
    }

    /**
     * get current app version via now/table rest api
     *
     * @param options object
     * @returns {Promise<string|boolean>}
     */
    function getCurrentApplicationVersion(options) {
        const table = options.is_app_customization ? 'sys_app_customization' : 'sys_app';
        if (options.sys_id) {
            const table = options.is_app_customization ? 'sys_app_customization' : 'sys_app';
            return request(`https://${config.instance}/api/now/table/${table}/${options.sys_id}?sysparm_fields=version`)
                .then(data => {
                    return (data && data.version) || false;
                })
                .catch(() => false);
        } else {
            return request(`https://${config.instance}/api/now/table/sys_app?sysparm_fields=scope,version`)
                .then(data => {
                    let version = false;
                    if (Array.isArray(data)) {
                        data = data.filter(e => e.scope === options.scope);
                        if (data[0]) {
                            version = data[0].version;
                        }
                    }
                    return version;
                })
                .catch((err) => console.log(err));
        }
    }

    /**
     * Make a wrapper to https request
     * @param url       string
     * @param data      object|boolean
     * @param method    string
     * @param payload   string
     * @returns {Promise<string>}
     */

    function request(url, data = false, method = 'GET', payload = '') {
        if (transport) {
            return transport(url, data, method);
        }
        if (data) {
            url = createURL(url, data.fields, data.options);
        }
        if (url.indexOf('https://') !== 0) {
            url = `https://${config.instance}/api/sn_cicd/${url}`;
        }
        let urldata = URL.parse(url);
        let options = { method };
        options.host = urldata.host;
        options.path = urldata.path;
        options.auth = config.auth;
        if (!options.headers) {
            options.headers = {};
        }
        options.headers.accept = 'application/json';
        options.headers['User-Agent'] = 'sncicd_extint_azure';

        return httpsRequest(options, payload)
            .catch(err => {
                let message = err.code || (
                    err.statusCode && (
                        errCodeMessages[err.statusCode] || err.statusCode
                    )
                );
                if (
                    err.statusCode &&
                    err.statusCode === 400 &&
                    err.body &&
                    err.body.error
                ) {
                    message = err.body.error;
                }
                if (
                    err.statusCode &&
                    err.statusCode === 200 &&
                    err.body.indexOf('class="instance-hibernating-page"') > 0
                ) {
                    message = 'Instance is hibernated';
                }
                return Promise.reject(new respError(message, err));
            });
    }

    /**
     *
     * @param object object
     * @param path string
     * @returns value mixed
     */
    function getPropertyByPath(object, path) {
        return path.split('.').reduce((xs, x) => (xs && xs[x]) ? xs[x] : null, object);
    }

    /**
     * Wrapper for https calls
     * @param params object
     * @param postData object
     * @returns {Promise<object>}
     */
    function httpsRequest(params, postData) {
        return new Promise(function(resolve, reject) {
            let req = https.request(params, function(res) {
                // reject on bad status
                let body = [];
                res.on('data', function(chunk) {
                    body.push(chunk);
                });
                res.on('end', function() {
                    body = Buffer.concat(body).toString();
                    let errState = res.statusCode !== 200;
                    try {
                        body = JSON.parse(body).result;
                    } catch (e) {
                        errState = true;
                    }
                    if (errState) {
                        reject({ statusCode: res.statusCode, body });
                    } else {
                        resolve(body);
                    }
                });
            });
            req.on('error', function(err) {
                reject(err);
            });
            if (params.method === 'POST' && postData) {
                req.write(postData);
            }
            req.end();
        });
    }
}

/**
 * helper for URL building
 * @param prefix string
 * @param fields string space-separated list of fields
 * @param options object
 * @returns {string}
 */
function createURL(prefix, fields, options) {
    const params = fields
        .split(' ')
        .filter(optName => options.hasOwnProperty(optName))
        .map(optName => optName + '=' + encodeURIComponent(options[optName]));

    return prefix + (params.length ? '?' + params.join('&') : '');
}

module.exports = ServiceNowCICDRestAPIService;
