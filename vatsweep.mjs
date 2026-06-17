import 'dotenv/config';
const BASE=process.env.VCR_URL, AUTH=Buffer.from(`${process.env.VCR_LOGIN}:${process.env.VCR_PASSWORD}`).toString('base64');
let id=1;
async function validate(icps, amount, vat){
  const body={id:id++,jsonrpc:'2.0',method:'Receipt.ValidateSale',auth:AUTH,params:{receipt:{positions:[{name:'probe',barcode:icps,icps,unit_name:'шт',amount,quantity:1000,vat_value:vat,discount:0,owner_type:'BuyingAndSelling'}],payments:[{type:1,value:amount}]},ignore_payments:true}};
  const r=await fetch(BASE,{method:'POST',headers:{'Content-Type':'application/json;charset=utf-8'},body:JSON.stringify(body)});
  const j=await r.json();
  return j.ok?'OK':(j.result?.description||'ERR');
}
const icps=process.argv[2]||'02004001004002007';
const amount=Number(process.argv[3]||10000);
console.log(`icps=${icps} amount=${amount}`);
for (const vat of [0,1,536,1071,1072,1200,Math.round(amount*0.12), Math.round(amount*12/112), Math.ceil(amount*12/112)]){
  const impl = vat>0 ? (vat*100/(amount-vat)).toFixed(3)+'%' : '0%';
  console.log(`  vat=${String(vat).padStart(6)} (impl ${impl.padStart(8)}) -> ${await validate(icps,amount,vat)}`);
  await new Promise(r=>setTimeout(r,120));
}
