@main
struct ReleaseEndpoints {
    static func main() {
        precondition(AppConfig.apiURL.absoluteString == "https://api.loonext.com")
        precondition(AppConfig.appOrigin.absoluteString == "https://app.loonext.com")
        precondition(AppConfig.supabaseURL.absoluteString == "https://qoruyuxcgkdqpcgclgzs.supabase.co")
        print("Release API, web and Supabase endpoints match production.")
    }
}
