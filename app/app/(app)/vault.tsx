import { Redirect } from 'expo-router'

/** The Vault lives on the Stock screen's Vault tab; this keeps old links and bookmarks working. */
export default function Vault() {
  return <Redirect href={{ pathname: '/inventory', params: { bucket: 'vault' } }} />
}
