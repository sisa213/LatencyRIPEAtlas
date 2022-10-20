import express from 'express'
import mysql from 'mysql2'
import { performance } from 'perf_hooks'
import ejs from 'ejs'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import axios from 'axios'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const port = process.env.PORT || 8080

let sources = []                         // probes and anchors in country of origin
let targets = []                         // anchors in country of destination
let values = []                          // results collected
const time_span = 7                      // number of days considered
const seconds_in_halfHour = 1800         // number of seconds in half an hour
const half_hours_span = time_span*24*2   // intervals of 30 minutes in seven days
let num_results = 0                      // results counter

const app = express()
app.engine('.html', ejs.__express)
app.use(express.json())
app.use(express.static(__dirname))
app.use(express.urlencoded( {extended: true} ))
app.set('views', __dirname)
app.set('view engine', 'ejs')

/**
 * Routing for rendering homepage 
 */ 
app.get('', (req, res) => {
    res.send('index.html')
})

/**
 * fillArrays: initializes sources and targets with data from probes&anchors database
 */
async function fillArrays (from, to) {
    console.log("I'm inside fillArrays")

    try {
        // establishing pool connection
        var pool = mysql.createPool({
            connectionLimit : 5,
            host     : 'localhost',
            user     : 'root',
            password : '',
            database : 'probes&anchors',
        })

        const sql0 = 'SELECT `id` FROM `anchors` WHERE `country`= ?'
        const sql1 = 'SELECT `fqdn` FROM `anchors` WHERE `country`= ?'

        const promisePool = pool.promise()
        // query database using promises
        const results1 = await promisePool.execute(sql0, [from])
        const results2 = await promisePool.execute(sql1, [to])
        await promisePool.end()

        //store results in arrays
        sources = results1[0].map(a => a.id)
        targets = results2[0].map(a => a.fqdn)

    } catch (err){
        console.log(err)
    }
}

/**
 * getTimestampInSeconds: returns UNIX timestamp of exactly seven days ago
 */
function getTimestampInSeconds () {

    const date = new Date()
    date.setDate(date.getDate() - time_span)
    const res = Math.floor(date / 1000)
    return res
}

/**
 * fetchData: fetches and stores ping measurement results
 */
const fetchData = async () => {
    console.log("I'm inside fecthData")
    let start_time = getTimestampInSeconds()

    for ( let t of targets ){

        // looking for anchoring measurements involving the current target
        let new_page = 'https://atlas.ripe.net/api/v2/measurements/ping/?status=2&target='+t+'&description__contains=anchoring&optional_fields=probes'
        console.log(new_page)
        let response = await axios.get(new_page)

        const data = response.data

        if (data.count==0) continue     //if there's none proceed to the next one
        let measurement = data.results[0]       // consider only first measurement

        const prbs_list = measurement.probes.map( i =>  i.id)      // listing all probe sources involved in measurement

        // getting probes which are in both prb_list and sources
        const filtered_sources = sources.filter(value => prbs_list.includes(value))   
        console.log("#filtered_sources: "+filtered_sources.length+"\n"+filtered_sources)

        // if there's any 
        if ( Array.isArray(filtered_sources) && filtered_sources.length ){
            
            for( let fs of filtered_sources ){

                // adding query for start_time
                const result_link = measurement.result
                let url_filtered_results = result_link+"?probe_ids="+fs+"&start="+start_time
                console.log(url_filtered_results)
                // fetching results from API
                const res_results = await axios.get(url_filtered_results)
                let result_set = res_results.data

                // if there's none consider next probe
                if ( Object.keys(result_set).length === 0){
                    continue
                }

                let base_time = start_time     // base time on which results are filtered

                for (let result of result_set){ 
    
                    // results with a value equal to -1 are considered invalid
                    // valid results stored from each pair set (unique source-target) must be at least 30 minutes apart
                    if(result.avg!=-1 && result.timestamp >= base_time){    
                        num_results++
                        console.log(num_results)

                        //each result is saved as an object
                        let n_elem = new Object()
                        n_elem.pair = t+result.prb_id       // pair identifies its source and target
                        n_elem.timestamp = result.timestamp     // result timestamp
                        n_elem.RTT = result.avg       // result RTT value
                        values.push(n_elem)     //pushing new result in values array
                        base_time = result.timestamp+seconds_in_halfHour      //update base_time for next result
                    }
                }
            }             
        }
    }
}

/*
compressDataset: compresses each half an hour of data into a single object. Returns new reduced array made up of these objects.
*/
function compressDataset(ar){

    //sort array by timestamp
    ar.sort((a, b) => a.timestamp - b.timestamp)

    //get first sub array length (and ending index)
    let sub_index = Math.floor(num_results / half_hours_span)  // number of components for each sub array

    //if there's any sub array to be created
    if (sub_index>1){

        console.log("sub_index: "+sub_index)
        let a_sindex = 0      // initializing first starting index with 0
        let b_sindex = sub_index    // initializing first ending index with sub_index

        // utility function for determining average of a dataset
        let getAverage = arr => {
            let reducer = (total, currentValue) => total + currentValue
            let sum = arr.reduce(reducer)
            return sum / arr.length
        }

        let new_ar = []    // array to be returned

        while (b_sindex < num_results){

            let sub_indexes = []    // utility array for containing indexes of elements which we'll form new sub array
            for (let i=a_sindex; i<b_sindex; i++){
                sub_indexes.push(i)
            }
            
            let sub_ar = sub_indexes.map(i=> ar[i])     // creating new sub array

            // creatig new object to replace sub array
            let obj = new Object()
            obj.timestamp = Math.trunc(getAverage(sub_ar.map(p=>p.timestamp)))    // its timestamp will be the average of all elements in subarray
            obj.RTT = getAverage(sub_ar.map(p=>p.RTT))      // same for its RTT value

            // get number of pairs source-target involved
            const pairs_set = new Set()
            sub_ar.forEach(element => {
                pairs_set.add(element.pair)     // values already present in the set won't be added
            })

            obj.pairs = pairs_set.size  // number of different pairs found in sub arry

            console.log(obj)
            new_ar.push(obj)

            // update indexes for new sub array
            a_sindex = b_sindex
            b_sindex += sub_index
            console.log("new a_sindex: "+a_sindex)
            console.log("new b_sindex: "+b_sindex)
        }
        return new_ar
    }
    else{   // if there are less results than double half_hours_span only pairs property will change

        // only pairs property must be modified
        ar.map(elem=>{
            elem.pairs=1
            delete elem.pair
        }) 
        return ar
    }

}

/*
Routing: receives data from the client and renders graph view while defining variables.
*/
app.post('/', async function(req,res){

    console.log("I'm inside app.post")

    let from = req.body.from_country    // country of origin
    let to = req.body.to_country        // country of destination
    console.log(from, to)

    await fillArrays(from, to)     // fill arrays based on user's input
    console.log("#sources: "+sources.length+"\n"+sources)
    console.log("#targets: "+targets.length+"\n"+targets)

    let startTime = performance.now()
    await fetchData()      // fetch results of interest
    let endTime = performance.now()
    let seconds = (endTime-startTime)/1000     // number of seconds for fetchData to finish

    let dataset = compressDataset(values)     // obtain dataset to use for graph
    console.log("dataset: ["+dataset.length+"]\n"+dataset)

    // utility function to obtain country name from its ISO 3166 ALPHA-2 abbreviation
    const regionNames = new Intl.DisplayNames(  
        ['en'], {type: 'region'}
      )

    // rendering file template and passing data
    res.render('graph', {data: JSON.stringify(dataset),
                         from: regionNames.of(from),
                         to: regionNames.of(to)})

    console.log(`Call to fetchData took ${seconds} seconds`)
    console.log("End")
})


app.listen(port)
console.log('Server started at http://localhost:' + port)

