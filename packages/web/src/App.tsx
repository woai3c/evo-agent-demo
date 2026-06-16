import { Link, Route, Routes } from 'react-router-dom'

import { AdminLayout } from './components/admin/AdminLayout'
import { AdminBehaviors } from './pages/admin/behaviors'
import { AdminErrors } from './pages/admin/errors'
import { AdminInspections } from './pages/admin/inspections'
import { AdminOverview } from './pages/admin/overview'
import { AdminPatterns } from './pages/admin/patterns'
import { AdminTraces } from './pages/admin/traces'
import { AdminTrends } from './pages/admin/trends'
import { Chat } from './pages/chat'

export function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="border-b bg-white px-6 py-3 flex items-center gap-6">
        <Link to="/" className="font-bold text-lg">
          Evo
        </Link>
        <Link to="/" className="text-sm text-gray-600 hover:text-gray-900">
          对话
        </Link>
        <Link to="/admin" className="text-sm text-gray-600 hover:text-gray-900">
          管理面板
        </Link>
      </nav>

      <Routes>
        <Route path="/" element={<Chat />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminOverview />} />
          <Route path="traces" element={<AdminTraces />} />
          <Route path="errors" element={<AdminErrors />} />
          <Route path="patterns" element={<AdminPatterns />} />
          <Route path="behaviors" element={<AdminBehaviors />} />
          <Route path="inspections" element={<AdminInspections />} />
          <Route path="trends" element={<AdminTrends />} />
        </Route>
      </Routes>
    </div>
  )
}
