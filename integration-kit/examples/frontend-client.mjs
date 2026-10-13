const endpoint=(baseUrl,path)=>baseUrl.replace(/\/$/,'')+'/api/v1/'+path;
export async function fetchNeaStatement(details,{signal,baseUrl=''}={}) {
  const response=await fetch(endpoint(baseUrl,'readings'),{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(details),signal,credentials:'omit',
  });
  const result=await response.json();
  if(!response.ok) throw new Error(result.error||'Could not fetch the NEA statement.');
  return result;
}
export async function fetchNeaBranches({signal,baseUrl=''}={}) {
  const response=await fetch(endpoint(baseUrl,'branches'),{signal,credentials:'omit'});
  const result=await response.json();
  if(!response.ok) throw new Error(result.error||'Could not fetch NEA branches.');
  return result.branches;
}
