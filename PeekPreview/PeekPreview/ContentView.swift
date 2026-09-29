//
//  ContentView.swift
//  PeekPreview
//
//  Created by Joshua Park on 9/29/26.
//

import AppKit
import SafariServices
import SwiftUI

let extensionBundleIdentifier = (Bundle.main.bundleIdentifier ?? "") + ".Extension"

struct ContentView: View {

    /// Whether the extension is on in Safari; `nil` until known.
    @State private var isEnabled: Bool?

    var body: some View {
        VStack(spacing: 20) {
            Image(nsImage: NSApp.applicationIconImage)
                .resizable()
                .frame(width: 128, height: 128)
                .accessibilityLabel("PeekPreview Icon")

            Text(status)

            Text(
                "Once it’s on, allow it on all websites, then hold **Shift** and click any link to preview it."
            )
            .foregroundStyle(.secondary)

            Button("Quit and Open Safari Settings…", action: openSafariSettings)
                .keyboardShortcut(.defaultAction)
        }
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, 40)
        .frame(width: 425, height: 325)
        .task { await refresh() }
        // Pick up changes made in Safari Settings while the app was in the background.
        .onReceive(
            NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)
        ) { _ in
            Task { await refresh() }
        }
    }

    private var status: LocalizedStringKey {
        switch isEnabled {
        case true?:
            "PeekPreview is currently on. You can turn it off in the Extensions section of Safari Settings."
        case false?:
            "PeekPreview is currently off. You can turn it on in the Extensions section of Safari Settings."
        case nil:
            "You can turn on PeekPreview in the Extensions section of Safari Settings."
        }
    }

    private func refresh() async {
        guard
            let state = try? await SFSafariExtensionManager.stateOfSafariExtension(
                withIdentifier: extensionBundleIdentifier)
        else {
            return
        }
        isEnabled = state.isEnabled
    }

    private func openSafariSettings() {
        Task {
            try? await SFSafariApplication.showPreferencesForExtension(
                withIdentifier: extensionBundleIdentifier)
            NSApp.terminate(nil)
        }
    }

}
