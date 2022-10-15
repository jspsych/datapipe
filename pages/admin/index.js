import AuthCheck from "../../components/AuthCheck";

export default function AdminPage({}) {
  return (
    <AuthCheck>
      <h1>Admin</h1>
      <ExperimentList />
    </AuthCheck>
  )
}

function ExperimentList() {
}