import XCTest
@testable import Loonext

final class WorkspaceCacheTests: XCTestCase {
    func testCacheTracksTheSignedInMemberAndSelectedWorkspace() {
        let credentials = InMemorySessionStorage()
        let workspaces = InMemorySessionStorage()
        let store = SessionStore(storage: credentials, workspaceStorage: workspaces)
        let me = Me(user_id: "member-1", display_name: "Sam", memberships: [], email_state: nil, company: nil)

        store.save(session(for: "member-1"))
        store.rememberReadyWorkspace(companyId: "workspace-1", me: me)
        let reopened = SessionStore(storage: credentials, workspaceStorage: workspaces)
        XCTAssertEqual(reopened.cachedWorkspace(companyId: "workspace-1")?.display_name, "Sam")
        XCTAssertNil(reopened.cachedWorkspace(companyId: "workspace-2"))

        reopened.save(session(for: "member-2"))
        XCTAssertNil(reopened.cachedWorkspace(companyId: "workspace-1"))
        XCTAssertNil(workspaces.read())

        reopened.save(session(for: "member-1"))
        reopened.rememberReadyWorkspace(companyId: "workspace-1", me: me)
        reopened.clear()
        XCTAssertNil(reopened.cachedWorkspace(companyId: "workspace-1"))
        XCTAssertNil(workspaces.read())
    }

    private func session(for id: String) -> Session {
        Session(accessToken: "access", refreshToken: "refresh", expiresAt: 1, userId: id, email: "mail@example.test")
    }
}
