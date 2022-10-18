import mysql from 'mysql';
import fetch from 'node-fetch';
import { promisify } from 'util';

const sql = "INSERT INTO probes (id, country, longitude, latitude) VALUES (?,?,?,?)";
const sql1 = "INSERT INTO anchors (id, fqdn, country, longitude, latitude) VALUES (?,?,?,?,?)";
const PAGE_SIZE = 100;
//let i=0, a=0;

const con = mysql.createConnection({
    host:'localhost',
    user:'root',
    password:'',
    database:'probes&anchors'
});

con.connect((err)=>{
    if(err){
        console.log("Connection not proper");
    }else{
        console.log("connected");
    }
});

const getNpgs = async (url) => {

    const res = await fetch(url);
    if (!res.ok) {
        const message = `An error has occured: ${res.status}`;
        throw new Error(message);
    }
    const data = await res.json();
    console.log(data.count);
    return Math.ceil(data.count/PAGE_SIZE);     
}

const getProbes = async (npg, stat) => {
    console.log("Sono in probes "+stat+"\n fetching in corso ...");
    for (let j=1; j<=npg; j++) {
        //console.log("j="+j);
        let URLi = "https://atlas.ripe.net/api/v2/probes/?page="+j+"&status="+stat;
        const res = await fetch(URLi);
        if (!res.ok) {
            const message = `An error has occured: ${res.status}`;
            throw new Error(message);
        }
        const data = await res.json();
        for (let probe of data.results){
           // i++;
            let id0 = probe.id;
            if (probe.country_code!=null && probe.geometry!=null){

                let country = probe.country_code;
                let longitude = probe.geometry.coordinates[0];
                let latitude = probe.geometry.coordinates[1];

                //console.log("id0: "+id0+"\t"+"cc: "+country+"\t"+"long: "+longitude+"\t"+"lati: "+latitude);
                //console.log(i);

                let promisifydbconnection = promisify(con.query).bind(con);
                await promisifydbconnection(sql, [id0, country, longitude, latitude]);
            }

        }
        
    }
}

const getAnchors = async (npg) => {
    console.log("Sono in anchors. \n Fetching in corso ...");
    for (let k=1; k<=npg; k++) {
        //console.log("k="+k);
        let URLi = "https://atlas.ripe.net/api/v2/anchors/?page="+k;
        const res = await fetch(URLi);
        if (!res.ok) {
            const message = `An error has occured: ${res.status}`;
            throw new Error(message);
          }
        const data = await res.json();
        for (let anchor of data.results){
            //a++;
            let id0 = anchor.probe;
            let fqdn = anchor.fqdn;
            let country = anchor.country;
            let longitude = anchor.geometry.coordinates[0];
            let latitude = anchor.geometry.coordinates[1];

            let promisifydbconnection = promisify(con.query).bind(con);
            await promisifydbconnection(sql1, [id0, fqdn, country, longitude, latitude]);
            //console.log("id0: "+id0+"\t"+"cc: "+country+"\t"+"long: "+longitude+"\t"+"lati: "+latitude);
            //console.log(a);
        }
        
    }
}

async function main(){
    
    const pgs1 = await getNpgs("https://atlas.ripe.net/api/v2/probes/?status=1");
    await getProbes(pgs1, 1);
    const pgs2 = await getNpgs("https://atlas.ripe.net/api/v2/probes/?status=2");
    await getProbes(pgs2, 2);
    const pgs3 = await getNpgs("https://atlas.ripe.net/api/v2/anchors");
    await getAnchors(pgs3);
    con.end();
    console.log("Fetching terminato.");
}

main();
