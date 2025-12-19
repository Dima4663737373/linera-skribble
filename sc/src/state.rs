// Copyright (c) Zefchain Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

use linera_sdk::views::{linera_views, RegisterView, RootView, ViewStorageContext};
use doodle_game::{GameRoom, ArchivedRoom};

/// The application state for Doodle Game
#[derive(RootView)]
#[view(context = ViewStorageContext)]
pub struct DoodleGameState {
    // Game room data
    pub room: RegisterView<Option<GameRoom>>,
    // Current word (only stored on drawer's chain)
    pub current_word: RegisterView<Option<String>>,
    // Host chain ID that player is subscribed to (to prevent duplicate subscriptions)
    // Only used by players
    pub subscribed_to_host: RegisterView<Option<String>>,
    // Archived rooms history (for storing data after deletion)
    pub archived_rooms: RegisterView<Vec<ArchivedRoom>>,
}