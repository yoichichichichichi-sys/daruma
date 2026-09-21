import UIKit

/// Blocking thumbnail fetch for widget timeline entries. WidgetKit snapshots
/// its view synchronously from whatever the TimelineProvider hands it, so
/// (like the Android widget's synchronous bitmap download in
/// UrlStackRemoteViewsService) the image has to already be in hand before
/// the entry is built - there's no async image loading inside a widget
/// snapshot the way AsyncImage works in the live app.
enum WidgetThumbnailLoader {
    private static let timeout: TimeInterval = 2

    static func fetch(_ urlString: String) -> UIImage? {
        guard let url = URL(string: urlString) else { return nil }

        let semaphore = DispatchSemaphore(value: 0)
        var result: UIImage?

        let task = URLSession.shared.dataTask(with: url) { data, _, _ in
            if let data, let image = UIImage(data: data) {
                result = image
            }
            semaphore.signal()
        }
        task.resume()
        _ = semaphore.wait(timeout: .now() + timeout)
        return result
    }
}
