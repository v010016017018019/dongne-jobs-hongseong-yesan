import {readFile,writeFile,mkdir,cp,readdir,rm} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {publicSnapshot} from '../lib/publication.mjs';
const root=resolve(import.meta.dirname,'..'),dist=resolve(root,'dist'),dataDir=resolve(process.env.JOB_MAP_DATA_DIR||resolve(root,'data'));
const read=async(name,fallback)=>{try{return JSON.parse(await readFile(resolve(dataDir,name),'utf8'));}catch(error){if(error.code==='ENOENT'&&fallback!==undefined)return fallback;throw error;}};
const config=JSON.parse(await readFile(resolve(root,'site.config.json'),'utf8'));
const snapshot=publicSnapshot({store:await read('jobs-v7.json'),details:await read('details-v7.json',{}),discovery:await read('discovery-v7.json',{firstSeenById:{},firstSeenByCanonical:{}}),history:await read('history-v7.json',null),config});
// Only the known generated output directory may be cleared.
if(relative(root,dist)!=='dist')throw new Error('Invalid output directory');
await rm(dist,{recursive:true,force:true});await mkdir(resolve(dist,'data'),{recursive:true});
await cp(resolve(root,'public'),dist,{recursive:true});await mkdir(resolve(dist,'vendor'),{recursive:true});
for(const [source,name]of [['leaflet/dist/leaflet.js','leaflet.js'],['leaflet/dist/leaflet.css','leaflet.css'],['leaflet.markercluster/dist/leaflet.markercluster.js','markercluster.js'],['leaflet.markercluster/dist/MarkerCluster.css','MarkerCluster.css']])await cp(resolve(root,'node_modules',source),resolve(dist,'vendor',name));
for(const packageName of ['leaflet','leaflet.markercluster']){
  const license=await readFile(resolve(root,'node_modules',packageName,'LICENSE'),'utf8').catch(()=>null);if(license)await writeFile(resolve(dist,'vendor',packageName+'-LICENSE.txt'),license);
}
const jobs=JSON.stringify(snapshot.jobs),history=JSON.stringify(snapshot.history),hash=value=>createHash('sha256').update(value).digest('hex').slice(0,16),jobFile=`jobs-${hash(jobs)}.json`,historyFile=`history-${hash(history)}.json`;
await writeFile(resolve(dist,'data',jobFile),jobs);await writeFile(resolve(dist,'data',historyFile),history);
await writeFile(resolve(dist,'data/manifest.json'),JSON.stringify({schema:1,version:'7.0.0',jobs:`/data/${jobFile}`,history:`/data/${historyFile}`,publication:snapshot.publication}));
const forbidden=/^(?:\.env|server\.mjs|personal.*\.json|manual.*\.json|locations.*\.json)$/;
async function check(dir){for(const file of await readdir(dir,{withFileTypes:true})){if(forbidden.test(file.name))throw new Error('Private file in publication: '+file.name);if(file.isDirectory())await check(resolve(dir,file.name));}}
await check(dist);console.log(JSON.stringify({version:'7.0.0',rawJobs:snapshot.jobs.jobs.length,groupedJobs:snapshot.jobs.quality.uniqueJobs,located:snapshot.jobs.quality.located,publication:snapshot.publication,output:'dist',personalDataIncluded:false}));
