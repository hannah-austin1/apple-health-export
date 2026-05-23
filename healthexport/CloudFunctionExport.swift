//
//  CloudFunctionExport.swift
//  healthexport
//

import Foundation

enum CloudFunctionExport {
    static let region = "europe-west1"
    static let functionName = "appleHealth"

    static func functionURL(projectID: String) -> URL? {
        let urlString = "https://\(region)-\(projectID).cloudfunctions.net/\(functionName)"
        return URL(string: urlString)
    }

    static func exportPayload(
        samples: [[String: String]],
        from: String,
        to: String
    ) throws -> Data {
        try JSONSerialization.data(withJSONObject: [
            "data": samples,
            "from": from,
            "to": to,
        ])
    }
}
