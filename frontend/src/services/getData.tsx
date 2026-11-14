import type {StellarData} from "../model/datosEstelares";

/** GET /api/{landing_site} **/
export async function getDatos(landing_site: string, datetime: Date = new Date()): Promise<StellarData> {
  const response = await fetch(`/api/${landing_site}`, {
        method: 'GET',
        body: JSON.stringify({fecha: datetime.toISOString()}),
    });
  if (!response.ok){
    throw new Error(`No se ha podido conseguir respuesta. Código HTTP: ${response.status}`)
  }
  let data = await response.json();

  return data;
}