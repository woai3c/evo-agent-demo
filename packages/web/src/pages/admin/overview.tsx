import { Link } from 'react-router-dom'

export function AdminOverview() {
  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Admin Dashboard</h1>

      {/* stats cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {['Total Operations', 'Success Rate', 'Avg Steps', 'P95 Latency'].map((label) => (
          <div key={label} className="rounded-lg border bg-white p-4">
            <p className="text-sm text-gray-500">{label}</p>
            <p className="text-2xl font-bold mt-1">—</p>
          </div>
        ))}
      </div>

      {/* navigation */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { to: '/admin/traces', label: 'Trace Explorer' },
          { to: '/admin/errors', label: 'Error Analysis' },
          { to: '/admin/patterns', label: 'Pattern Registry' },
          { to: '/admin/inspections', label: 'Inspection Log' },
          { to: '/admin/trends', label: 'Evolution Trends' },
        ].map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="rounded-lg border bg-white p-4 hover:border-blue-500 transition-colors"
          >
            <p className="font-semibold">{item.label}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
