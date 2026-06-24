import {
  Activity,
  AlertTriangle,
  Boxes,
  FileSearch,
  LayoutDashboard,
  ScanSearch,
  Shield,
  TrendingUp,
} from 'lucide-react'

import { NavLink, Outlet } from 'react-router-dom'

const NAV_ITEMS = [
  { to: '/admin', label: '概览', icon: LayoutDashboard, end: true },
  { to: '/admin/traces', label: 'Trace 浏览器', icon: FileSearch },
  { to: '/admin/errors', label: '错误分析', icon: AlertTriangle },
  { to: '/admin/patterns', label: 'Pattern 库', icon: Shield },
  { to: '/admin/behaviors', label: '行为分析', icon: Boxes },
  { to: '/admin/inspections', label: '巡检记录', icon: ScanSearch },
  { to: '/admin/trends', label: '进化趋势', icon: TrendingUp },
]

export function AdminLayout() {
  return (
    <div className="flex h-[calc(100vh-57px)]">
      <aside className="w-56 border-r bg-white flex flex-col">
        <div className="px-4 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-500">
            <Activity className="h-4 w-4" />
            管理面板
          </div>
        </div>
        <nav className="flex-1 px-2 space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto bg-gray-50">
        <Outlet />
      </main>
    </div>
  )
}
