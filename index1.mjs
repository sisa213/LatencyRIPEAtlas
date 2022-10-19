import express from 'express'
import mysql from 'mysql2'
import { performance } from 'perf_hooks'
import ejs from 'ejs'
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import axios from 'axios'

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let sources;    // fqdn of anchors located in from_country
let mesh_measurements; // url of mesh_measurements targeting to_country
let values = [];     
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
fillArrays: initializes sources with data from anchors table
*/
async function fillArrays (from, to) {

    try {
        var pool = mysql.createPool({
            connectionLimit : 10,
            host     : 'localhost',
            user     : 'root',
            password : '',
            database : 'anchor_measurements',
        });    

        console.log("sono in fillArrays")
        const sql0 = 'SELECT `id_probe` FROM `anchors` WHERE `country`= ?'
        const sql1 = 'SELECT `url` FROM `anchor_measurements` WHERE `country`= ? AND `type`="ping" AND `is_mesh`=true'


        const promisePool = pool.promise();
        // query database using promises
        const results0 = await promisePool.execute(sql0, [from]);
        const results1 = await promisePool.execute(sql1, [to]);
        await promisePool.end();

        //fetch data to arrays
        sources = results0[0].map(a => a.id_probe);
        mesh_measurements = results1[0].map(a => a.url);

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
    console.log("Sono dentro fetchData")
    let start_time = getTimestampInSeconds(false)
    let anchor_source = sources[0]
    let targets_analysed = []

    for ( let m of mesh_measurements ){

        let id_measurement0 = m.substring(43)
        let id_measurement = id_measurement0.slice(0,-1)
        console.log("id_measurement: "+id_measurement)

        let m_response = await axios.get("https://atlas.ripe.net/api/v2/measurements/?id="+id_measurement+"&optional_fields=probes")

        let m0 = await m_response.data

        console.log("data: "+m0)
        let measurement = m0.results[0]
        console.log("measurement: "+measurement)
        //checks if target has already been checked
        if( targets_analysed.includes(measurement.target)){
            console.log("same target")
            continue
        }

        let target = measurement.target
        targets_analysed.push(target)

        let probes_listed = measurement.probes

        const prbs_list = probes_listed.map( i =>  i.id)

        const filtered_sources = sources.filter(value => prbs_list.includes(value));
        console.log("#filtered_sources: "+filtered_sources.length+"\n"+filtered_sources);

        if ( Array.isArray(filtered_sources) && filtered_sources.length ){

            if (anchor_source==0 || !filtered_sources.includes(anchor_source)){
                anchor_source = filtered_sources[0]
            }

            //aggiungo una query per lo starttime
            const result_link = m+"results/"
            let url_filtered_results = result_link+"?probe_ids="+anchor_source+"&start="+start_time

            console.log(url_filtered_results)

            var startTime0 = performance.now()
            const res_results = await axios.get(url_filtered_results)
            var endTime0 = performance.now()
            seconds0 = (endTime0-startTime0)/1000

            //aggiungere fetch a anchor_measure per ottenere probe_sources
            let result_set = res_results.data

            let invalid_pair = true
            let base_time = start_time;
            for (let result of result_set){ 
                        
                if(result.avg!=-1 && result.timestamp >= base_time){
                    num_results++;
                    console.log(num_results);
                    invalid_pair=false
                    let n_elem = new Object();
                    n_elem.targets = target;
                    n_elem.timestamp = result.timestamp;
                    n_elem.RTT = result.avg;
                    values.push(n_elem);
                    base_time = result.timestamp+1200;
                }
            }
            if (invalid_pair==true) {
                const indexOfElem = targets_analysed.findIndex(elem => {
                    return elem === target ;
                });
                targets_analysed.splice(indexOfElem, 1);
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

            //get number of targets involved
            const anchors_set = new Set()
            sub_ar.forEach(element => {
                anchors_set.add(element.targets)
            });
            console.log("number of targets for sub_ar: "+anchors_set);

            obj.anchors = anchors_set.size

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
        ar.map(elem=>{elem.anchors=1})
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
    console.log("#targets: "+mesh_measurements.length+"\n"+mesh_measurements);
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

    res.render('graph1', {data: JSON.stringify(dataset),
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

