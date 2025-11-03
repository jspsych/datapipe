export async function validateOsfAccess(osfToken, componentId) {
  try {

    const response = await fetch(`https://api.${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/v2/nodes/${componentId}/`, {
      headers: {
        'Authorization': `Bearer ${osfToken}`,
        'Accept': 'application/vnd.api+json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      
      if (response.status === 403) {
        throw new Error('You do not have access to this OSF project.');
      } else if (response.status === 404) {
        throw new Error('OSF project not found.');
      } else {
        throw new Error(`Failed to validate OSF project access: ${response.status}`);
      }
    }

    return true;
  } catch (error) {
    throw error;
  }
}

export async function getOsfComponentInfo(osfToken, componentId) {
  try {

    const response = await fetch(`https://api.${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/v2/nodes/${componentId}/`, {
      headers: {
        'Authorization': `Bearer ${osfToken}`,
        'Accept': 'application/vnd.api+json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch OSF component information: ${response.status}`);
    }

    const data = await response.json();
    return {
      id: data.data.id,
      title: data.data.attributes.title,
      description: data.data.attributes.description,
      category: data.data.attributes.category
    };
  } catch (error) {
    throw error;
  }
}

export function cleanOsfUrl(osfUrl) {
  if (typeof osfUrl !== 'string') {
    return osfUrl;
  }
  
  // Remove https://osf.io/ prefix if present
  if (osfUrl.includes("https://osf.io/")) {
    return osfUrl.replace("https://osf.io/", "");
  }
  
  return osfUrl;
}

export function generateOsfComponentName(baseName = "DataPipe Data") {
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
  return `${baseName} - ${date}`;
}

export async function checkOsfTokenValidity(osfToken) {
  try {
    const response = await fetch(`https://api.${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/v2/users/me/`, {
      headers: {
        'Authorization': `Bearer ${osfToken}`,
        'Accept': 'application/vnd.api+json'
      }
    });

    return response.ok;
  } catch (error) {
    return false;
  }
}