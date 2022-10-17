import AuthCheck from "../../components/AuthCheck"

export default function ProfilePage({}) {
  return (
    <AuthCheck>
      <h1>Profile</h1>
      <input type="text" id="osf-token" placeholder="OSF Token" />
    </AuthCheck>
  )
}