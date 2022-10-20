import mysql from 'mysql'
import axios from 'axios'

// sql query statements
const sql0 = "INSERT INTO probes (id, country, longitude, latitude) VALUES (?,?,?,?)"
const sql1 = "INSERT INTO anchors (id, fqdn, country, longitude, latitude) VALUES (?,?,?,?,?)"
const PAGE_SIZE = 100      // number of ojects listed in a single page
let pool     // global pool connection for queries

try {   // creating pool connection to database
    pool = mysql.createPool({
        connectionLimit : 5,
        host     : 'localhost',
        user     : 'root',
        password : '',
        database : 'probes&anchors',
    })
} catch (err){
    console.log(err)
}

/**
 * getNpgs: returns number of pages of a resource in RIPE Atlas API
 */
const getNpgs = async (url) => {

    const res = await axios.get(url)
    const data = await res.data

    console.log("number of objects: "+data.count)
    return Math.ceil(data.count/PAGE_SIZE)
}

/**
 * getProbes: fetches probes from RIPE Atlas API and stores them in the database
 */

const getProbes = async (npg, stat) => {
    console.log("I'm inside getProbes "+stat+"\n fetching ongoing ...")

    for (let i=1; i<=npg; i++) {
        let URLi = "https://atlas.ripe.net/api/v2/probes/?page="+i+"&status="+stat
        const res = await axios.get(URLi)   //fetching probes with status equal to 'stat'
        const data = res.data

        for (let probe of data.results){

            // storing only probes with defined location
            if (probe.country_code!=null && probe.geometry!=null){

                let id0 = probe.id     // probe id
                let country = probe.country_code   // probe country
                let longitude = probe.geometry.coordinates[0]  // probe position: longitude
                let latitude = probe.geometry.coordinates[1]   // probe position: latitude

                const promisePool = pool.promise()
                // query database using promises
                await promisePool.execute(sql0, [id0, country, longitude, latitude])
            }
        }
    }
}

/**
 * getAnchors: fetches anchors from RIPE Atlas API and stores them in the database
 */
const getAnchors = async (npg) => {
    console.log("I'm inside getAnchors \n fetching ongoing ...")
    for (let i=1; i<=npg; i++) {
        let URLi = "https://atlas.ripe.net/api/v2/anchors/?page="+i
        const res = await axios.get(URLi)   // fetching anchors
        const data = res.data

        for (let anchor of data.results){

            let id = anchor.probe  // anchor id
            let fqdn = anchor.fqdn  // anchor fqdn
            let country = anchor.country    // anchor country
            let longitude = anchor.geometry.coordinates[0]  // anchor position: longitude
            let latitude = anchor.geometry.coordinates[1]   // anchor position: latitude

            const promisePool = pool.promise()
            // query database using promises
            await promisePool.execute(sql1, [id, fqdn, country, longitude, latitude])
        }
    }
}

async function main(){
    
    const pgs1 = await getNpgs("https://atlas.ripe.net/api/v2/probes/?status=1")
    await getProbes(pgs1, 1)    // storing connected probes (status=1)
    const pgs2 = await getNpgs("https://atlas.ripe.net/api/v2/probes/?status=2")
    await getProbes(pgs2, 2)   // storing disconnected probes (status=2)
    const pgs3 = await getNpgs("https://atlas.ripe.net/api/v2/anchors")
    await getAnchors(pgs3)     // storing anchors
    await promisePool.end()    // close pool connection
    console.log("Fetching terminated.")
}

main()
