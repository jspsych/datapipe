import AuthCheck from '../../components/AuthCheck';

export default function ExperimentPage() {
  return (
    <AuthCheck>
      <h1>Experiment Page</h1>
    </AuthCheck>
  )
}