import { Link } from 'react-router-dom'
import { EmptyState, Button, Card } from '../components/ui'

export function NotFound() {
  return (
    <Card>
      <EmptyState title="Seite nicht gefunden" action={<Link to="/"><Button variant="primary">Zum Dashboard</Button></Link>}>
        Diese Adresse gibt es in der Anwendung nicht.
      </EmptyState>
    </Card>
  )
}
