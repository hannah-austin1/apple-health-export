//
//  CloudFunctionExportTests.swift
//  healthexportTests
//

import Foundation
import Testing
@testable import healthexport

struct CloudFunctionExportTests {

    @Test func functionURLUsesRegionAndProject() throws {
        let url = try #require(CloudFunctionExport.functionURL(projectID: "my-project"))
        #expect(url.absoluteString == "https://europe-west1-my-project.cloudfunctions.net/appleHealth")
    }

    @Test func exportPayloadEncodesSamplesAndDateRange() throws {
        let data = try CloudFunctionExport.exportPayload(
            samples: [["type": "Steps", "date": "2026-05-17", "value": "100", "unit": "count"]],
            from: "2026-05-17",
            to: "2026-05-17"
        )
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let samples = json?["data"] as? [[String: String]]
        #expect(json?["from"] as? String == "2026-05-17")
        #expect(json?["to"] as? String == "2026-05-17")
        #expect(samples?.count == 1)
        #expect(samples?.first?["type"] == "Steps")
    }
}
