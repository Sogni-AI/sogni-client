import { v4 as uuidV4 } from '@lukeed/uuid';

// Mac app is using uppercase UUIDs, we need to keep it consistent so Mac workers can process the data
function getUUID() {
  return uuidV4().toUpperCase();
}

export default getUUID;
