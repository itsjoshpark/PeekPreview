//
//  SafariWebExtensionHandler.swift
//  PeekPreview Extension
//
//  Created by Joshua Park on 9/27/26.
//

import SafariServices

// The extension is pure JavaScript and does not use native messaging.
class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        context.completeRequest(returningItems: [], completionHandler: nil)
    }

}
