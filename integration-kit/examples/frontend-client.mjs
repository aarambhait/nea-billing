export async function fetchNeaStatement(details,{signal}={}) {
  const response=await fetch('/api/readings',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(details),signal,
  });
  const result=await response.json();
  if(!response.ok) throw new Error(result.error||'Could not fetch the NEA statement.');
  return result;
}
export async function fetchNeaBranches({signal}={}) {
  const response=await fetch('/api/branches',{signal});
  const result=await response.json();
  if(!response.ok) throw new Error(result.error||'Could not fetch NEA branches.');
  return result.branches;
}
