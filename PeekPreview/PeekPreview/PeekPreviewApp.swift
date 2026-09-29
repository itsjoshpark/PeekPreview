//
//  PeekPreviewApp.swift
//  PeekPreview
//
//  Created by Joshua Park on 9/29/26.
//

import SwiftUI

@main
struct PeekPreviewApp: App {

    var body: some Scene {
        // A single `Window` scene quits the app when it closes.
        Window("PeekPreview", id: "main") {
            ContentView()
                .windowMinimizeBehavior(.disabled)
                .windowFullScreenBehavior(.disabled)
        }
        .windowResizability(.contentSize)
        .restorationBehavior(.disabled)
        .commands {
            CommandGroup(replacing: .newItem) {}
        }
    }

}
