export function Chat() {
  return (
    <div className="flex h-[calc(100vh-57px)]">
      {/* sidebar: conversation list */}
      <aside className="w-64 border-r bg-white p-4">
        <h2 className="font-semibold text-sm text-gray-500 mb-3">Conversations</h2>
        <p className="text-sm text-gray-400">No conversations yet</p>
      </aside>

      {/* main chat area */}
      <main className="flex-1 flex flex-col">
        <div className="flex-1 overflow-y-auto p-6">
          <p className="text-gray-400 text-center mt-20">Start a conversation with Evo</p>
        </div>

        {/* input */}
        <div className="border-t p-4">
          <div className="max-w-3xl mx-auto flex gap-2">
            <input
              type="text"
              placeholder="Type a message..."
              className="flex-1 rounded-lg border px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">Send</button>
          </div>
        </div>
      </main>
    </div>
  )
}
