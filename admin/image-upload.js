export async function validateImage(){throw Error('Photo uploading is not enabled in this production release.');}
export async function uploadImage(){throw Error('Photo uploading is not enabled in this production release.');}
export async function imageControls({input}){input.disabled=true;const element=document.createElement('p');element.className='help';element.textContent='Your saved photo is preserved. Photo changes are not enabled yet.';return {element,selectedURL:async()=>null};}
