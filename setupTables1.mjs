import mysql from 'mysql2'
import axios from 'axios'

const sql0 = "INSERT INTO anchor_measurements (id_measurement, id_anchor, id_probe, is_mesh, country, type, url) VALUES (?,?,?,?,?,?,?)"
const sql1 = "INSERT INTO anchors (id_anchor, id_probe, fqdn, country, longitude, latitude) VALUES (?,?,?,?,?,?)"
const PAGE_SIZE = 100
let promisePool


try {
    var pool = mysql.createPool({
        connectionLimit : 5,
        host     : 'localhost',
        user     : 'root',
        password : '',
        database : 'anchor_measurements',
    })   

    promisePool = pool.promise()

} catch (err){
    console.log(err)
}


/*
getNpgs: returns number of pages of list of objects in RIPE Atlas API
*/
const getNpgs = async (url) => {

    const res = await axios.get(url)
    const data = res.data
    console.log(data.count)
    return Math.ceil(data.count/PAGE_SIZE)   
}


/*
getAnchorMeasurements: populates anchor_measurements table with data fetched from RIPE Atlas API
*/
const getAnchorMeasurements = async (npg) => {
    console.log("Sono in getAnchorMeasurements "+"\n fetching in corso ...")
    for (let j=1; j<=npg; j++) {

        let URLi = "https://atlas.ripe.net/api/v2/anchor-measurements/?page="+j+"&include=target"
        const res = await axios.get(URLi)

        const data = res.data

        for (let anchor_measurement of data.results){

            let id_measurement = anchor_measurement.id
            let id_anchor = anchor_measurement.target.id 
            let id_probe = anchor_measurement.target.probe 
            let is_mesh = anchor_measurement.is_mesh
            let country = anchor_measurement.target.country
            let type = anchor_measurement.type
            let url = anchor_measurement.measurement+"results/"

            const promisePool = pool.promise()
            // query database using promises
            await promisePool.execute(sql0, [id_measurement, id_anchor, id_probe, is_mesh, country, type, url])
        }
    }
}


/*
getAnchors: populates anchors table with data fetched from RIPE Atlas API
*/
const getAnchors = async (npg) => {
    console.log("Sono in getAnchors \n fetching in corso ...")
    for (let k=1; k<=npg; k++) {
        let URLi = "https://atlas.ripe.net/api/v2/anchors/?page="+k
        const res = await axios.get(URLi)

        const data = res.data
        for (let anchor of data.results){
            //a++;
            let id0 = anchor.id
            let id1 = anchor.probe
            let fqdn = anchor.fqdn
            let country = anchor.country
            let longitude = anchor.geometry.coordinates[0]
            let latitude = anchor.geometry.coordinates[1]

            const promisePool = pool.promise()
            // query database using promises
            await promisePool.execute(sql1, [id0, id1, fqdn, country, longitude, latitude])
        }   
    }
}


async function main(){
    
    const pgs0 = await getNpgs("https://atlas.ripe.net/api/v2/anchor-measurements/")
    await getAnchorMeasurements(pgs0)
    const pgs1 = await getNpgs("https://atlas.ripe.net/api/v2/anchors/")
    await getAnchors(pgs1)
    await promisePool.end()
    console.log("Fetching terminato.")
}


main()
