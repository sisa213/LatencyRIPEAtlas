import fetch from 'node-fetch'
import express from 'express'
import mysql from 'mysql2'
import { performance } from 'perf_hooks'
import ejs from 'ejs'
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import axios from 'axios'

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let sources;    // probes and anchors in from_country
let targets;    // anchors in to_country
let values = new Array();     
let time_span = 7;     //days
let num_results = 0;
let seconds0;

const app = express();

app.engine('.html', ejs.__express);
app.use(express.json());
app.use(express.static(__dirname));
app.use(express.urlencoded( {extended: true} ));
app.set('views', __dirname);
app.set('view engine', 'ejs');

app.get('', (req, res) => {
    res.send('index.html');
})

const port = process.env.PORT || 8080;

/*
fillArrays: initializes sources and targets with data from probes&anchors database
*/
async function fillArrays (from, to) {

    try {
        var pool = mysql.createPool({
            connectionLimit : 10,
            host     : 'localhost',
            user     : 'root',
            password : '',
            database : 'probes&anchors',
        });    

        console.log("sono in fillArrays")
        const sql0 = 'SELECT `id` FROM `anchors` WHERE `country`= ?';
        const sql1 = 'SELECT `fqdn` FROM `anchors` WHERE `country`= ?';

        const promisePool = pool.promise();
        // query database using promises
        const results1 = await promisePool.execute(sql0, [from]);
        const results2 = await promisePool.execute(sql1, [to]);
        await promisePool.end();

        //fetch data to array
        sources = results1[0].map(a => a.id);
        targets = results2[0].map(a => a.fqdn);

    } catch (err){
        console.log(err)
    }
}

/*
getTimestampInSeconds: if now is false returns the UNIX timestamp of exactly seven days ago otherwise current timestamp
*/
function getTimestampInSeconds (now) {

    const date = new Date();
    date.setDate(date.getDate() - (now==true?0:time_span));
    const res = Math.floor(date / 1000);
    console.log(res);
    return res;
}

/*
fetchData: fetches and stores in values (array) ping measurement results of interest
*/
const fetchData = async () => {
    console.log("Sono dentro fetchData e qui targets deve essere pronto");
    let start_time = getTimestampInSeconds(false);
    let anchor_source=0;

    for ( let t of targets ){

        let new_page = 'https://atlas.ripe.net/api/v2/measurements/ping/?status=2&target='+t+'&description__contains=mesh&optional_fields=probes';
        console.log(new_page);

        let response = await fetch(new_page);    
        const data = await response.json();
        if (data.count==0) continue;
        let measurement = data.results[0]

        console.log("sono dentro il secondo for");

        const prbs_list = measurement.probes.map( i =>  i.id)

        const filtered_sources = sources.filter(value => prbs_list.includes(value));
        console.log("#filtered_sources: "+filtered_sources.length+"\n"+filtered_sources);

        if ( Array.isArray(filtered_sources) && filtered_sources.length ){

            if (anchor_source==0 || !filtered_sources.includes(anchor_source)){
                anchor_source = filtered_sources[0]
            }
          
            //aggiungo una query per lo starttime
            const result_link = measurement.result;
            let url_filtered_results = result_link+"?probe_ids="+anchor_source+"&start="+start_time;

            console.log(url_filtered_results);
                
            //const res_results = await fetch(url_filtered_results);
            var startTime0 = performance.now();
            const res_results = await axios.get(url_filtered_results);
            var endTime0 = performance.now();
            seconds0 = (endTime0-startTime0)/1000;

            /* var startTime0 = performance.now();
            let result_set = await res_results.json();  */
            let result_set = res_results.data 
            /* var endTime0 = performance.now();
            seconds0 = (endTime0-startTime0)/1000; */

            if ( Object.keys(result_set).length === 0){
                        continue;
            }

            console.log("sono dentro un result_set: ..dovrebbe essere uno valido a cui poi seguono i valori presi");

            let base_time = start_time;
            for (let result of result_set){ 
                     
                if(result.avg!=-1 && result.timestamp >= base_time){
                        num_results++;
                        console.log(num_results);

                        let n_elem = new Object();
                        n_elem.targets = t;
                        n_elem.timestamp = result.timestamp;
                        n_elem.RTT = result.avg;
                        values.push(n_elem);
                        //console.log(n_elem);
                        base_time = result.timestamp+1200;
                }
            }
        }
    }
}

/*
compressDataset: compresses each hour of data into a single object. Returns new reduced array made up of these objects.
*/
function compressDataset(ar){

    //sort array by timestamp
    ar.sort((a, b) => a.timestamp - b.timestamp);

    //get subarrays
    let third_hours_span = time_span*72
    console.log("num_results: "+num_results)
    console.log("third_hours_span: "+third_hours_span)
    let sub_index = Math.floor(num_results / third_hours_span);
    if (sub_index>=1){

        console.log("sub_index: "+sub_index);
        let a_sindex = 0;
        let b_sindex = sub_index;

        let getAverage = arr => {
            let reducer = (total, currentValue) => total + currentValue;
            let sum = arr.reduce(reducer)
            return sum / arr.length;
        };


        let new_ar = [];

        while (b_sindex<=num_results){

            console.log("a_sindex: "+a_sindex)
            console.log("b_sindex: "+b_sindex)
            let sub_indexes = []
            for (let i=a_sindex; i<b_sindex; i++){
                sub_indexes.push(i)
            }
            
            let sub_ar = sub_indexes.map(i=> ar[i])
            console.log("sub_ar: "+sub_ar)
            console.log("sub_ar[2]: "+sub_ar[2].timestamp)

            //calculate avg
            let obj = new Object()
            obj.timestamp = Math.trunc(getAverage(sub_ar.map(p=>p.timestamp)))
            console.log("obj.timestamp: "+obj.timestamp)
            obj.RTT = getAverage(sub_ar.map(p=>p.RTT))

            //get number of couples source-probe participating
            const probes_set = new Set()
            sub_ar.forEach(element => {
                probes_set.add(element.targets)
            });
            console.log("number of targets for sub_ar: "+probes_set);

            obj.probes = probes_set.size

            new_ar.push(obj);

            //update indexes
            a_sindex = b_sindex
            b_sindex += sub_index
            console.log("new a_sindex: "+a_sindex)
            console.log("new b_sindex: "+b_sindex)
        }
        return new_ar
    }
    else{
        ar.map(elem=>{elem.probes=1})
        return ar
    }

    
}

/*
Routing: receives data from the client and renders graph view while defining variables.
*/
app.post('/', async function(req,res){

    console.log("sono dentro post");

    console.log(req.body.from_country, req.body.to_country);
    await fillArrays(req.body.from_country, req.body.to_country);
    console.log("#sources: "+sources.length+"\n"+sources);
    console.log("#targets: "+targets.length+"\n"+targets);
    var startTime = performance.now();
    await fetchData();
    var endTime = performance.now();
    var seconds = (endTime-startTime)/1000;

    let dataset = compressDataset(values);
    console.log("dataset: "+dataset);
    console.log("dataset.length :"+dataset.length)

    const regionNames = new Intl.DisplayNames(
        ['en'], {type: 'region'}
      );

    res.render('graph', {data: JSON.stringify(dataset),
                         from: regionNames.of(req.body.from_country),
                         to: regionNames.of(req.body.to_country)});

    console.log("End");
    console.log( dataset.filter(obj => {return obj.RTT>100}));
    console.log(`Call to fetchData took ${seconds} seconds`);
    console.log(`Call to await .json() took ${seconds0} seconds`);
    //console.log(values);
});


app.listen(port);
console.log('Server started at http://localhost:' + port);

