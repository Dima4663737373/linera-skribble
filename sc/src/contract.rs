// Copyright (c) Zefchain Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

#![cfg_attr(target_arch = "wasm32", no_main)]

mod state;

use doodle_game::{Operation, DoodleGameAbi, Player, GameState, ChatMessage, ArchivedRoom, CrossChainMessage, Invitation};
use linera_sdk::{
    linera_base_types::{WithContractAbi, StreamName, ChainId},
    views::{RootView, View},
    Contract, ContractRuntime,
};
use async_graphql::ComplexObject;

use self::state::DoodleGameState;

linera_sdk::contract!(DoodleGameContract);

pub struct DoodleGameContract {
    state: DoodleGameState,
    runtime: ContractRuntime<Self>,
}

impl WithContractAbi for DoodleGameContract {
    type Abi = DoodleGameAbi;
}

impl DoodleGameContract {
    /// Subscribe to ALL players when they join (host only)
    /// Events will be filtered by current_drawer_index in process_streams
    fn subscribe_to_player(&mut self, player_chain_id: &str) {
        let current_chain = self.runtime.chain_id();
        if let Some(room) = self.state.room.get() {
            // Only host subscribes to players
            if room.host_chain_id == current_chain.to_string() {
                if let Ok(player_chain) = player_chain_id.parse() {
                    let app_id = self.runtime.application_id().forget_abi();
                    let stream = StreamName::from(format!("game_events_{}", room.room_id));
                    
                    eprintln!("[SUBSCRIPTION] Host subscribing to player chain {:?}", player_chain);
                    self.runtime.subscribe_to_events(player_chain, app_id, stream);
                    eprintln!("[SUBSCRIPTION] Subscribed to player events");
                }
            }
        }
    }
}

impl Contract for DoodleGameContract {
    type Message = doodle_game::CrossChainMessage;
    type InstantiationArgument = ();
    type Parameters = ();
    type EventValue = doodle_game::DoodleEvent;

    async fn load(runtime: ContractRuntime<Self>) -> Self {
        let state = DoodleGameState::load(runtime.root_view_storage_context())
            .await
            .expect("Failed to load state");
        DoodleGameContract { state, runtime }
    }

    async fn instantiate(&mut self, _argument: ()) {
        self.state.room.set(None);
        self.state.current_word.set(None);
        self.state.friends.set(Vec::new());
        self.state.friend_requests_received.set(Vec::new());
        self.state.friend_requests_sent.set(Vec::new());
        self.state.room_invitations.set(Vec::new());
        self.state.sent_invitations.set(Vec::new());
        eprintln!("[INIT] Doodle Game contract initialized on chain {:?}", self.runtime.chain_id());
    }

    async fn execute_operation(&mut self, operation: Operation) -> () {
        match operation {
            Operation::CreateRoom { host_name, avatar_json } => {
                let host_chain_id = self.runtime.chain_id().to_string();
                let timestamp = self.runtime.system_time().micros().to_string();
                
                let room = doodle_game::GameRoom::new(host_chain_id.clone(), host_name.clone(), avatar_json, timestamp);
                self.state.room.set(Some(room.clone()));
                
                // HOST: Subscribe to self (host is also a player)
                self.subscribe_to_player(&host_chain_id);
                
                eprintln!("[CREATE_ROOM] Room created by host '{}'", host_name);
            }

            Operation::JoinRoom { host_chain_id, player_name, avatar_json } => {
                eprintln!("[JOIN_ROOM] Sending join request to host chain '{}' from player '{}'", host_chain_id, player_name);
                
                if let Ok(target_chain) = host_chain_id.parse() {
                    // Send join request directly - host will send InitialStateSync which will trigger subscription
                    let message = doodle_game::CrossChainMessage::JoinRequest {
                        player_chain_id: self.runtime.chain_id(),
                        player_name,
                        avatar_json,
                    };
                    
                    self.runtime.send_message(target_chain, message);
                    eprintln!("[JOIN_ROOM] Join request sent to chain {}", host_chain_id);
                } else {
                    eprintln!("[JOIN_ROOM] Invalid host_chain_id format: {}", host_chain_id);
                }
            }

            Operation::StartGame { rounds, seconds_per_round } => {
                if let Some(mut room) = self.state.room.get().clone() {
                    let timestamp = self.runtime.system_time().micros().to_string();
                    
                    // Clean up invites
                    let sent_invites = self.state.sent_invitations.get().clone();
                    for target in sent_invites {
                        if let Ok(target_chain) = target.parse::<ChainId>() {
                             let message = doodle_game::CrossChainMessage::RoomInvitationCancelled {
                                 host_chain_id: self.runtime.chain_id(),
                             };
                             self.runtime.send_message(target_chain, message);
                        }
                    }
                    self.state.sent_invitations.set(Vec::new());

                    room.start_game(rounds, seconds_per_round, timestamp.clone());
                    
                    // Automatically choose first drawer for round 1
                    if let Some(drawer_index) = room.choose_drawer(timestamp.clone()) {
                        // SAFE: Check bounds before accessing
                        if let Some(drawer) = room.players.get(drawer_index) {
                            let drawer_name = drawer.name.clone();
                            
                            self.state.room.set(Some(room.clone()));
                            
                            // Emit single combined event with game start + drawer info
                            self.runtime.emit(format!("game_events_{}", room.room_id).into(), &doodle_game::DoodleEvent::GameStarted { 
                                rounds, 
                                seconds_per_round,
                                drawer_index,
                                drawer_name: drawer_name.clone(),
                                timestamp: timestamp.clone()
                            });
                            
                            eprintln!("[START_GAME] Game started with {} rounds, {} seconds per round, first drawer: {}", rounds, seconds_per_round, drawer_name);
                        } else {
                            eprintln!("[START_GAME] ERROR: Drawer index {} out of bounds (players: {})", drawer_index, room.players.len());
                        }
                    }
                }
            }

            Operation::ChooseDrawer => {
                if let Some(mut room) = self.state.room.get().clone() {
                    let timestamp = self.runtime.system_time().micros().to_string();
                    
                    // Host only check
                    if self.runtime.chain_id() != room.host_chain_id.parse().unwrap() {
                        panic!("Only host can select drawer");
                    }
                    
                    // Note: Logic for saving previous blob hash moved to async workflow.
                    // Frontend publishes blob, collects hash, and sends all hashes on LeaveRoom.

                    // Check if all players have drawn in current round before choosing next drawer
                    let should_advance_round = room.has_all_players_drawn_in_round();
                    
                    if should_advance_round {
                        // All players have drawn - advance to next round
                        let scores: Vec<(String, u32)> = room.players.iter()
                            .map(|p| (p.name.clone(), p.score))
                            .collect();
                        
                        let previous_round = room.current_round;
                        room.advance_to_next_round(timestamp.clone());
                        
                        if room.game_state == GameState::GameEnded {
                            // Game ended - no more rounds
                            
                            // Important: We do NOT archive here automatically anymore if we rely on explicit LeaveRoom with hashes.
                            // However, if the game ends naturally, we might want to trigger archiving.
                            // But since we want to collect LAST ROUND'S blob hash from frontend, 
                            // we should probably defer archiving to the explicit EndMatch/LeaveRoom call from host?
                            // OR, we can archive what we have so far?
                            // The user said: "host must pass empty string or null on choose drawer... and [blob hashes] on LeaveRoom"
                            
                            self.state.room.set(Some(room.clone()));
                            
                            // Emit game ended event
                            self.runtime.emit(format!("game_events_{}", room.room_id).into(), &doodle_game::DoodleEvent::GameEnded { 
                                final_scores: scores,
                                timestamp: timestamp.clone()
                            });
                            eprintln!("[CHOOSE_DRAWER] Game ended after round {} at {}", previous_round, timestamp);
                            return;
                        } else {
                            // Emit round ended event
                            self.runtime.emit(format!("game_events_{}", room.room_id).into(), &doodle_game::DoodleEvent::RoundEnded { 
                                scores,
                                timestamp: timestamp.clone()
                            });
                            eprintln!("[CHOOSE_DRAWER] Round {} completed, advancing to round {}", previous_round, room.current_round);
                        }
                    }
                    
                    // Choose next drawer (either in same round or new round)
                    if let Some(drawer_index) = room.choose_drawer(timestamp.clone()) {
                        // SAFE: Check bounds before accessing
                        if let Some(drawer) = room.players.get(drawer_index) {
                            let drawer_name = drawer.name.clone();
                            
                            self.state.room.set(Some(room.clone()));
                            
                            // Emit event to all subscribers - NO previous blob hash here
                            self.runtime.emit(format!("game_events_{}", room.room_id).into(), &doodle_game::DoodleEvent::DrawerChosen { 
                                drawer_index, 
                                drawer_name: drawer_name.clone(),
                                timestamp: timestamp.clone(),
                                previous_blob_hash: None, // Logic moved to async publish
                            });
                            
                            eprintln!("[CHOOSE_DRAWER] Drawer chosen: {} (index: {}) at {}", drawer_name, drawer_index, timestamp);
                        } else {
                            eprintln!("[CHOOSE_DRAWER] ERROR: Drawer index {} out of bounds (players: {})", drawer_index, room.players.len());
                        }
                    } else {
                        eprintln!("[CHOOSE_DRAWER] ERROR: Failed to choose drawer (no players?)");
                    }
                }
            }

            Operation::ChooseWord { word } => {
                if let Some(mut room) = self.state.room.get().clone() {
                    let timestamp = self.runtime.system_time().micros().to_string();
                    room.choose_word(timestamp.clone());
                    self.state.room.set(Some(room));
                    
                    // Store the word only on drawer's chain (secret)
                    self.state.current_word.set(Some(word));
                    
                    // Emit event with timestamp only (not the word)
                    if let Some(room) = self.state.room.get() {
                        self.runtime.emit(format!("game_events_{}", room.room_id).into(), &doodle_game::DoodleEvent::WordChosen { 
                            timestamp: timestamp.clone() 
                        });
                    }
                    
                    eprintln!("[CHOOSE_WORD] Word chosen at timestamp {}", timestamp);
                }
            }



            Operation::GuessWord { guess } => {
                if let Some(room) = self.state.room.get() {
                    if let Some(drawer) = room.get_current_drawer() {
                        // Send guess to drawer's chain
                        if let Ok(drawer_chain) = drawer.chain_id.parse() {
                            let message = doodle_game::CrossChainMessage::GuessSubmission {
                                guesser_chain_id: self.runtime.chain_id(),
                                guess,
                                round: room.current_round,
                            };
                            
                            self.runtime.send_message(drawer_chain, message);
                            eprintln!("[GUESS_WORD] Guess sent to drawer's chain");
                        }
                    }
                }
            }



            Operation::EndMatch => {
                if let Some(room) = self.state.room.get().clone() {
                    let timestamp = self.runtime.system_time().micros().to_string();
                    
                    // Only host can end the match
                    let current_chain = self.runtime.chain_id();
                    if room.host_chain_id == current_chain.to_string() {
                        let room_host = room.host_chain_id.clone();
                        let player_count = room.players.len();
                        
                        eprintln!("[END_MATCH] Starting room deletion process. Host: {}, Players: {}", room_host, player_count);
                        
                        let mut archived_list = self.state.archived_rooms.get().clone();
                        let archive_number = archived_list.len() + 1;
                        let archived = ArchivedRoom {
                            room_id: format!("{}#{}", room.room_id, archive_number),
                            blob_hashes: room.blob_hashes.clone(),
                            timestamp: timestamp.clone(),
                        };
                        archived_list.push(archived.clone());
                        self.state.archived_rooms.set(archived_list);

                        // 1. FIRST: Send room deletion message to ALL players (with archive data)
                        eprintln!("[END_MATCH] Sending RoomDeleted with Archive to {} players", room.players.len());
                        for player in &room.players {
                            eprintln!("[END_MATCH] Preparing deletion message for player '{}' on chain '{}'", player.name, player.chain_id);
                            if let Ok(chain_id) = player.chain_id.parse() {
                                let deletion_message = doodle_game::CrossChainMessage::RoomDeleted {
                                    timestamp: timestamp.clone(),
                                    archived_room: Some(archived.clone()),
                                };
                                self.runtime.send_message(chain_id, deletion_message);
                                eprintln!("[END_MATCH] ✅ RoomDeleted message sent to chain {:?} ({})", chain_id, player.name);
                            } else {
                                eprintln!("[END_MATCH] ❌ ERROR: Failed to parse chain_id '{}' for player '{}'", player.chain_id, player.name);
                            }
                        }
                        
                        eprintln!("[END_MATCH] Waiting for players to process deletion messages...");
                        
                        // 2. THEN: Emit match ended event for any local subscribers
                        self.runtime.emit(format!("game_events_{}", room.room_id).into(), &doodle_game::DoodleEvent::MatchEnded { 
                            timestamp: timestamp.clone()
                        });
                        
                        // 3. THEN: Unsubscribe HOST from ALL players (host cleanup)
                        let app_id = self.runtime.application_id().forget_abi();
                        let stream = StreamName::from(format!("game_events_{}", room.room_id));
                        for player in &room.players {
                            if let Ok(player_chain) = player.chain_id.parse() {
                                eprintln!("[END_MATCH] Host unsubscribing from player chain {:?}", player_chain);
                                self.runtime.unsubscribe_from_events(player_chain, app_id, stream.clone());
                            }
                        }
                        



                        // 5. FINALLY: Delete host's own room state (last step!)
                        self.state.room.set(None);
                        self.state.current_word.set(None);
                        
                        eprintln!("[END_MATCH] Room hosted by '{}' completely deleted at {}. {} players disconnected and unsubscribed.", 
                                 room_host, timestamp, player_count);
                    } else {
                        eprintln!("[END_MATCH] ERROR: Only host can end the match. Current chain: {:?}, Host chain: {}", current_chain, room.host_chain_id);
                    }
                } else {
                    eprintln!("[END_MATCH] ERROR: No active room to end");
                }
            }


            Operation::LeaveRoom { blob_hashes } => {
                let mut room = self.state.room.get().clone().expect("Room not found");
                
                // If Host leaves, treat as EndMatch -> Archive and Delete Room
                if self.runtime.chain_id() == room.host_chain_id.parse().unwrap() {
                     // Create Archive
                     // Use provided hashes or fall back to internal ones (if any were mixed)
                     let mut final_hashes = if let Some(h) = blob_hashes { h } else { Vec::new() };
                     if final_hashes.is_empty() {
                         final_hashes = room.blob_hashes.clone();
                     }

                     let timestamp = self.runtime.system_time().micros().to_string();
                     let mut archives = self.state.archived_rooms.get().clone();
                     let archive_number = archives.len() + 1;
                     let archived_room = ArchivedRoom {
                         room_id: format!("{}#{}", room.room_id, archive_number),
                         blob_hashes: final_hashes,
                         timestamp: timestamp.clone(), 
                     };
                     
                     // Store Archive Locally
                     archives.push(archived_room.clone());
                     self.state.archived_rooms.set(archives);

                    let msg = CrossChainMessage::RoomDeleted { 
                        timestamp: timestamp.clone(),
                        archived_room: Some(archived_room) 
                    };
                    
                    for player in &room.players {
                        if let Ok(chain_id) = player.chain_id.parse::<ChainId>() {
                             if chain_id != self.runtime.chain_id() {
                                 let _ = self.runtime.send_message(chain_id, msg.clone());
                             }
                        }
                    }
                    
                    // Clear state
                    self.state.room.set(None);
                    self.state.current_word.set(None);

                } else {
                    // Regular player leaving
                    let current_chain = self.runtime.chain_id();
                    let player_name = room.players.iter().find(|p| p.chain_id == current_chain.to_string()).map(|p| p.name.clone());

                    room.players.retain(|p| p.chain_id != current_chain.to_string());
                    self.state.room.set(Some(room.clone()));

                     // Notify host
                    if let Ok(host_id) = room.host_chain_id.parse::<linera_sdk::linera_base_types::ChainId>() {
                         let msg = CrossChainMessage::PlayerLeft {
                             player_chain_id: current_chain,
                             player_name,
                             timestamp: self.runtime.system_time().micros().to_string(),
                         };
                         let _ = self.runtime.send_message(host_id, msg);
                    }
                }
            }

            Operation::ReadDataBlob { hash } => {
                // Parse the hex string to DataBlobHash via CryptoHash
                use linera_sdk::linera_base_types::{CryptoHash, DataBlobHash};
                use std::str::FromStr;
                
                match CryptoHash::from_str(&hash) {
                    Ok(crypto_hash) => {
                        let blob_hash = DataBlobHash(crypto_hash);
                        let data = self.runtime.read_data_blob(blob_hash);
                        eprintln!("[READ_BLOB] Read {} bytes from blob {}", data.len(), hash);
                    }
                    Err(e) => {
                        eprintln!("[READ_BLOB] ERROR: Invalid blob hash format '{}': {:?}", hash, e);
                    }
                }
            }

            // Friend System
            Operation::RequestFriend { target_chain_id } => {
                let target_chain: ChainId = target_chain_id.parse().expect("Invalid chain ID");
                let mut sent = self.state.friend_requests_sent.get().clone();
                if !sent.contains(&target_chain_id) {
                    sent.push(target_chain_id.clone());
                    self.state.friend_requests_sent.set(sent);
                    
                    let message = CrossChainMessage::FriendRequest {
                        requester_chain_id: self.runtime.chain_id(),
                    };
                    self.runtime.send_message(target_chain, message);
                }
            }
            
            Operation::AcceptFriend { requester_chain_id } => {
                let mut received = self.state.friend_requests_received.get().clone();
                if let Some(pos) = received.iter().position(|x| x == &requester_chain_id) {
                    received.remove(pos);
                    self.state.friend_requests_received.set(received);
                    
                    let mut friends = self.state.friends.get().clone();
                    if !friends.contains(&requester_chain_id) {
                        friends.push(requester_chain_id.clone());
                        self.state.friends.set(friends);
                        
                        let target_chain: ChainId = requester_chain_id.parse().expect("Invalid chain ID");
                        let message = CrossChainMessage::FriendAccepted {
                            target_chain_id: self.runtime.chain_id(),
                        };
                        self.runtime.send_message(target_chain, message);
                    }
                }
            }
            
            Operation::DeclineFriend { requester_chain_id } => {
                let mut received = self.state.friend_requests_received.get().clone();
                if let Some(pos) = received.iter().position(|x| x == &requester_chain_id) {
                    received.remove(pos);
                    self.state.friend_requests_received.set(received);
                }
            }
            
            Operation::InviteFriend { friend_chain_id } => {
                let friends = self.state.friends.get();
                if friends.contains(&friend_chain_id) {
                     let target_chain: ChainId = friend_chain_id.parse().expect("Invalid chain ID");
                     
                     let mut sent_invites = self.state.sent_invitations.get().clone();
                     if !sent_invites.contains(&friend_chain_id) {
                         sent_invites.push(friend_chain_id.clone());
                         self.state.sent_invitations.set(sent_invites);
                         
                         let timestamp = self.runtime.system_time().micros().to_string();
                         let message = CrossChainMessage::RoomInvitation {
                             host_chain_id: self.runtime.chain_id(),
                             timestamp,
                         };
                         self.runtime.send_message(target_chain, message);
                     }
                }
            }
            
            Operation::AcceptInvite { host_chain_id, player_name, avatar_json } => {
                 let mut invitations = self.state.room_invitations.get().clone();
                 if let Some(pos) = invitations.iter().position(|inv| inv.host_chain_id == host_chain_id) {
                     let invite = &invitations[pos];
                     let invite_time: u64 = invite.timestamp.parse().unwrap_or(0);
                     let current_time = self.runtime.system_time().micros();
                     
                     // 5 minutes = 300,000,000 microseconds
                     if current_time > invite_time && current_time.saturating_sub(invite_time) <= 300_000_000 {
                         // Valid invite
                         invitations.remove(pos);
                         self.state.room_invitations.set(invitations);
                         
                         // Execute Join Room Logic
                         if let Ok(target_chain) = host_chain_id.parse::<ChainId>() {
                             let message = CrossChainMessage::JoinRequest {
                                 player_chain_id: self.runtime.chain_id(),
                                 player_name,
                                 avatar_json,
                             };
                             self.runtime.send_message(target_chain, message);
                         }
                     } else {
                         // Expired
                         invitations.remove(pos);
                         self.state.room_invitations.set(invitations);
                     }
                 }
            }
            
            Operation::DeclineInvite { host_chain_id } => {
                 let mut invitations = self.state.room_invitations.get().clone();
                 if let Some(pos) = invitations.iter().position(|inv| inv.host_chain_id == host_chain_id) {
                     invitations.remove(pos);
                     self.state.room_invitations.set(invitations);
                 }
            }
        }
    }

    async fn execute_message(&mut self, message: Self::Message) {
        match message {
            doodle_game::CrossChainMessage::JoinRequest { player_chain_id, player_name, avatar_json } => {
                eprintln!("[JOIN_REQUEST] Received join request from player '{}' on chain {:?}", player_name, player_chain_id);
                
                if let Some(mut room) = self.state.room.get().clone() {
                    let timestamp = self.runtime.system_time().micros().to_string();
                    let player = Player {
                        chain_id: player_chain_id.to_string(),
                        name: player_name.clone(),
                        avatar_json,
                        score: 0,
                        has_guessed: false,
                    };
                    
                    room.add_player(player.clone());
                    self.state.room.set(Some(room.clone()));
                    
                    // HOST: Subscribe to this player's events immediately
                    // This way we're subscribed to ALL players and just filter by current_drawer
                    self.subscribe_to_player(&player.chain_id);
                    
                    // Send initial state to the new player (includes all players)
                    let sync_message = doodle_game::CrossChainMessage::InitialStateSync {
                        room_data: room.clone(),
                    };
                    self.runtime.send_message(player_chain_id, sync_message);
                    eprintln!("[JOIN_REQUEST] Initial state sent to player '{}'", player_name);
                    
                    // Emit PlayerJoined event for EXISTING players (new player already has state via InitialStateSync)
                    // This notifies other players that someone joined
                    self.runtime.emit(format!("game_events_{}", room.room_id).into(), &doodle_game::DoodleEvent::PlayerJoined { 
                        player: player.clone(),
                        timestamp: timestamp.clone()
                    });
                    
                    eprintln!("[JOIN_REQUEST] Player '{}' added to room, subscribed, and PlayerJoined event emitted", player_name);
                }
            }

            doodle_game::CrossChainMessage::InitialStateSync { room_data } => {
                eprintln!("[INITIAL_STATE_SYNC] Received initial room state from host");
                eprintln!("[INITIAL_STATE_SYNC] Room: {} players, state: {:?}, round: {}/{}", 
                    room_data.players.len(), room_data.game_state, room_data.current_round, room_data.total_rounds);
                
                // Subscribe to single aggregated host stream (instead of 8 separate streams)
                let host_chain_id = room_data.host_chain_id.clone();
                let already_subscribed = self.state.subscribed_to_host.get()
                    .as_ref()
                    .map(|h| h == &host_chain_id)
                    .unwrap_or(false);
                
                if !already_subscribed {
                    if let Ok(host_chain) = host_chain_id.parse() {
                        let app_id = self.runtime.application_id().forget_abi();
                        
                        // Single subscription to aggregated game_events stream
                        // Host re-emits ALL events to this stream
                        eprintln!("[INITIAL_STATE_SYNC] Subscribing to aggregated game_events_<room_id> stream");
                        let stream = StreamName::from(format!("game_events_{}", room_data.room_id));
                        self.runtime.subscribe_to_events(host_chain, app_id, stream);
                        
                        self.state.subscribed_to_host.set(Some(host_chain_id));
                        eprintln!("[INITIAL_STATE_SYNC] Subscribed to host game_events stream (1 subscription total)");
                    }
                }
                
                // Set the complete room state on player's chain
                self.state.room.set(Some(room_data));
                
                eprintln!("[INITIAL_STATE_SYNC] Player now has complete room state");
            }

            doodle_game::CrossChainMessage::GuessSubmission { guesser_chain_id, guess, round } => {
                eprintln!("[GUESS_SUBMISSION] Received guess '{}' from chain {:?}", guess, guesser_chain_id);
                
                if let (Some(mut room), Some(current_word)) = (self.state.room.get().clone(), self.state.current_word.get()) {
                    if room.current_round == round {
                        // Знаходимо ім'я гравця за чейн ід
                        let guesser_name = room.players.iter()
                            .find(|p| p.chain_id == guesser_chain_id.to_string())
                            .map(|p| p.name.clone())
                            .unwrap_or_else(|| format!("Player_{}", guesser_chain_id));
                        
                        // Check if player already guessed
                        let already_guessed = room.players.iter()
                            .any(|p| p.name == guesser_name && p.has_guessed);
                        
                        if already_guessed {
                            eprintln!("[GUESS_SUBMISSION] Player '{}' already guessed - ignoring", guesser_name);
                            return;
                        }
                        
                        let is_correct = current_word.to_lowercase() == guess.to_lowercase();
                        
                        // Calculate points based on how many players already guessed
                        let points = if is_correct {
                            let guessed_count = room.players.iter().filter(|p| p.has_guessed).count() as u32;
                            // First guesser: 100, second: 90, third: 80, etc.
                            100u32.saturating_sub(guessed_count * 10).max(10)
                        } else {
                            0
                        };
                        
                        let chat_message = ChatMessage {
                            player_name: guesser_name.clone(),
                            message: if is_correct { 
                                format!("[Correct! +{} points]", points)
                            } else { 
                                guess.clone() 
                            },
                            is_correct_guess: is_correct,
                            points_awarded: points,
                        };
                        
                        // Add to chat and update state on drawer's chain
                        room.add_chat_message(chat_message.clone());
                        
                        // MEMORY OPTIMIZATION: Keep only last 10 chat messages to prevent overflow
                        if room.chat_messages.len() > 10 {
                            room.chat_messages = room.chat_messages.split_off(room.chat_messages.len() - 10);
                            eprintln!("[GUESS_SUBMISSION] Trimmed chat to last 10 messages");
                        }
                        
                        if is_correct {
                            room.award_points(&guesser_name, points);
                            eprintln!("[GUESS_SUBMISSION] Player '{}' guessed correctly! Awarded {} points", guesser_name, points);
                        }
                        
                        self.state.room.set(Some(room.clone()));
                        
                        // Emit ChatMessage event - host will receive it and re-emit to all players
                        if let Some(room) = self.state.room.get() {
                            self.runtime.emit(format!("game_events_{}", room.room_id).into(), &doodle_game::DoodleEvent::ChatMessage {
                                message: chat_message.clone()
                            });
                        }
                        
                        eprintln!("[GUESS_SUBMISSION] ChatMessage emitted for guess '{}' from '{}'", guess, guesser_name);
                    }
                }
            }

            doodle_game::CrossChainMessage::RoomDeleted { timestamp, archived_room } => {
                eprintln!("[ROOM_DELETED] Received room deletion message at {}", timestamp);
                
                // Save archived room if provided
                if let Some(archived) = archived_room {
                    let mut archived_list = self.state.archived_rooms.get().clone();
                    if !archived_list.iter().any(|r| r.room_id == archived.room_id) {
                        eprintln!("[ROOM_DELETED] Saving archived room history locally: {}", archived.room_id);
                        archived_list.push(archived);
                        self.state.archived_rooms.set(archived_list);
                    }
                }
                
                // Get room data before clearing (for unsubscribe)
                let room_data = self.state.room.get().clone();
                
                // Unsubscribe from host events (cleanup)
                if let Some(room) = &room_data {
                    if let Ok(host_chain) = room.host_chain_id.parse() {
                        let app_id = self.runtime.application_id().forget_abi();
                        
                        eprintln!("[ROOM_DELETED] Unsubscribing from host chain {:?}", host_chain);
                        let stream = StreamName::from(format!("game_events_{}", room.room_id));
                        self.runtime.unsubscribe_from_events(host_chain, app_id, stream);
                        eprintln!("[ROOM_DELETED] Unsubscribed from game_events stream");
                    }
                }
                
                // Completely clear player state
                self.state.room.set(None);
                self.state.current_word.set(None);
                self.state.subscribed_to_host.set(None); // Clear subscription tracking
                
                if room_data.is_some() {
                    eprintln!("[ROOM_DELETED] Player disconnected from room, unsubscribed, and all state cleared");
                } else {
                    eprintln!("[ROOM_DELETED] Player was already disconnected");
                }
            }

            doodle_game::CrossChainMessage::PlayerLeft { player_chain_id, player_name, timestamp } => {
                eprintln!("[PLAYER_LEFT] Player {:?} ('{:?}') left at {}", player_chain_id, player_name, timestamp);
                if let Some(mut room) = self.state.room.get().clone() {
                    let app_id = self.runtime.application_id().forget_abi();
                    let stream = StreamName::from(format!("game_events_{}", room.room_id));
                    self.runtime.unsubscribe_from_events(player_chain_id, app_id, stream);
                    let removed_index = room.players.iter().position(|p| p.chain_id == player_chain_id.to_string());
                    room.players.retain(|p| p.chain_id != player_chain_id.to_string());
                    if let Some(idx) = removed_index {
                        if let Some(current_idx) = room.current_drawer_index {
                            if current_idx == idx {
                                room.current_drawer_index = None;
                                room.game_state = GameState::ChoosingDrawer;
                                room.word_chosen_at = None;
                                room.drawer_chosen_at = None;
                                eprintln!("[PLAYER_LEFT] Current drawer left; resetting drawer selection");
                            } else if current_idx > idx {
                                room.current_drawer_index = Some(current_idx - 1);
                            }
                        }
                    }
                    self.state.room.set(Some(room));
                    eprintln!("[PLAYER_LEFT] Player removed from room and host unsubscribed from their events");
                }
            }
            
            doodle_game::CrossChainMessage::FriendRequest { requester_chain_id } => {
                let mut received = self.state.friend_requests_received.get().clone();
                let requester_str = requester_chain_id.to_string();
                if !received.contains(&requester_str) {
                    received.push(requester_str);
                    self.state.friend_requests_received.set(received);
                }
            }
            
            doodle_game::CrossChainMessage::FriendAccepted { target_chain_id } => {
                 let target_str = target_chain_id.to_string();
                 
                 // Add to friends
                 let mut friends = self.state.friends.get().clone();
                 if !friends.contains(&target_str) {
                     friends.push(target_str.clone());
                     self.state.friends.set(friends);
                 }
                 
                 // Remove from sent requests
                 let mut sent = self.state.friend_requests_sent.get().clone();
                 if let Some(pos) = sent.iter().position(|x| x == &target_str) {
                     sent.remove(pos);
                     self.state.friend_requests_sent.set(sent);
                 }
            }
            
            doodle_game::CrossChainMessage::RoomInvitation { host_chain_id, timestamp } => {
                let mut invitations = self.state.room_invitations.get().clone();
                let host_str = host_chain_id.to_string();
                
                // Avoid duplicates from same host
                if !invitations.iter().any(|inv| inv.host_chain_id == host_str) {
                    invitations.push(Invitation {
                        host_chain_id: host_str,
                        timestamp,
                    });
                    self.state.room_invitations.set(invitations);
                }
            }
            
            doodle_game::CrossChainMessage::RoomInvitationCancelled { host_chain_id } => {
                let mut invitations = self.state.room_invitations.get().clone();
                let host_str = host_chain_id.to_string();
                
                if let Some(pos) = invitations.iter().position(|inv| inv.host_chain_id == host_str) {
                    invitations.remove(pos);
                    self.state.room_invitations.set(invitations);
                }
            }
        }
    }

    async fn process_streams(&mut self, streams: Vec<linera_sdk::linera_base_types::StreamUpdate>) {
        let current_chain = self.runtime.chain_id();
        
        for stream_update in streams {
            // Skip processing events from our own chain to avoid redundant inbox processing
            // We already processed these events when we emitted them
            if stream_update.chain_id == current_chain {
                eprintln!("[STREAM_UPDATE] Skipping self-events from chain {:?} to avoid redundant processing", current_chain);
                continue;
            }
            
            eprintln!("[STREAM_UPDATE] Processing stream update from chain {:?}", stream_update.chain_id);
            
            for index in stream_update.previous_index..stream_update.next_index {
                let stream_name = stream_update.stream_id.stream_name.clone();
                match self.runtime.read_event(stream_update.chain_id, stream_name, index) {
                    event => {
                        match event {
                            // PlayerJoined event - for existing players when new player joins
                            // New player gets full state via InitialStateSync
                            doodle_game::DoodleEvent::PlayerJoined { player, timestamp } => {
                                eprintln!("[STREAM_UPDATE] Player joined event: {} at {}", player.name, timestamp);
                                if let Some(mut room) = self.state.room.get().clone() {
                                    // Add player if not already in list (idempotent)
                                    if !room.players.iter().any(|p| p.chain_id == player.chain_id) {
                                        room.add_player(player.clone());
                                        self.state.room.set(Some(room));
                                        eprintln!("[STREAM_UPDATE] Player '{}' added to local room state", player.name);
                                    } else {
                                        eprintln!("[STREAM_UPDATE] Player '{}' already in room, skipping", player.name);
                                    }
                                }
                            }
                            
                            doodle_game::DoodleEvent::GameStarted { rounds, seconds_per_round, drawer_index, drawer_name, timestamp } => {
                                eprintln!("[STREAM_UPDATE] Game started: {} rounds, first drawer: {} at {}", rounds, drawer_name, timestamp);
                                
                                if let Some(mut room) = self.state.room.get().clone() {
                                    room.start_game(rounds, seconds_per_round, timestamp.clone());
                                    room.current_drawer_index = Some(drawer_index);
                                    room.game_state = GameState::WaitingForWord;
                                    room.drawer_chosen_at = Some(timestamp);
                                    // Ensure previous drawing state is cleared at new game start
                                    room.word_chosen_at = None;
                                    
                                    // Reset has_guessed for all players at game start
                                    for player in &mut room.players {
                                        player.has_guessed = false;
                                    }
                                    
                                    self.state.room.set(Some(room));
                                    eprintln!("[STREAM_UPDATE] Game started with drawer and has_guessed reset");
                                }
                            }
                            
                            doodle_game::DoodleEvent::DrawerChosen { drawer_index, drawer_name, timestamp, .. } => {
                                eprintln!("[STREAM_UPDATE] Drawer chosen: {} at {}", drawer_name, timestamp);
                                
                                if let Some(mut room) = self.state.room.get().clone() {
                                    room.current_drawer_index = Some(drawer_index);
                                    room.game_state = GameState::WaitingForWord;
                                    room.drawer_chosen_at = Some(timestamp);
                                    // Clear any previous word timing when a new drawer is selected
                                    room.word_chosen_at = None;
                                    
                                    // CRITICAL: Reset has_guessed for all players when new drawer is chosen
                                    // This ensures point calculation starts fresh (100, 90, 80...)
                                    for player in &mut room.players {
                                        player.has_guessed = false;
                                    }
                                    
                                    self.state.room.set(Some(room));
                                    eprintln!("[STREAM_UPDATE] Drawer updated and has_guessed reset");
                                }
                            }
                            
                            doodle_game::DoodleEvent::WordChosen { timestamp } => {
                                eprintln!("[STREAM_UPDATE] Word chosen event from chain {:?} at: {}", stream_update.chain_id, timestamp);
                                
                                // FILTER: Only process if event is from current drawer
                                let is_from_current_drawer = if let Some(room) = self.state.room.get() {
                                    room.get_current_drawer()
                                        .map(|drawer| drawer.chain_id == stream_update.chain_id.to_string())
                                        .unwrap_or(false)
                                } else {
                                    false
                                };
                                
                                if !is_from_current_drawer {
                                    eprintln!("[STREAM_UPDATE] Ignoring WordChosen from non-drawer chain {:?}", stream_update.chain_id);
                                    return;
                                }
                                
                                // Update local state FIRST
                                if let Some(mut room) = self.state.room.get().clone() {
                                    room.word_chosen_at = Some(timestamp.clone());
                                    room.game_state = GameState::Drawing;
                                    self.state.room.set(Some(room));
                                    eprintln!("[STREAM_UPDATE] Word chosen processed in local state");
                                }
                                
                                // THEN re-emit if we're host and event from drawer
                                let current_chain = self.runtime.chain_id();
                                if let Some(room) = self.state.room.get() {
                                    if room.host_chain_id == current_chain.to_string() && stream_update.chain_id != current_chain {
                                        eprintln!("[STREAM_UPDATE] Host re-emitting WordChosen from drawer to all players");
                                        if let Some(room) = self.state.room.get() {
                                            self.runtime.emit(format!("game_events_{}", room.room_id).into(), &doodle_game::DoodleEvent::WordChosen { 
                                                timestamp: timestamp.clone() 
                                            });
                                        }
                                    }
                                }
                            }
                            
                            doodle_game::DoodleEvent::ChatMessage { message } => {
                                eprintln!("[STREAM_UPDATE] Chat message from chain {:?}: {}", stream_update.chain_id, message.player_name);
                                
                                // FILTER: Only process if event is from current drawer
                                let is_from_current_drawer = if let Some(room) = self.state.room.get() {
                                    room.get_current_drawer()
                                        .map(|drawer| drawer.chain_id == stream_update.chain_id.to_string())
                                        .unwrap_or(false)
                                } else {
                                    false
                                };
                                
                                if !is_from_current_drawer {
                                    eprintln!("[STREAM_UPDATE] Ignoring ChatMessage from non-drawer chain {:?}", stream_update.chain_id);
                                    return;
                                }
                                
                                let current_chain = self.runtime.chain_id();
                                let is_host = if let Some(room) = self.state.room.get() {
                                    room.host_chain_id == current_chain.to_string()
                                } else {
                                    false
                                };
                                
                                // Process event FIRST (update local state)
                                if let Some(mut room) = self.state.room.get().clone() {
                                    // Only add to chat if not already there (check by player_name + message)
                                    let already_exists = room.chat_messages.iter().any(|m| 
                                        m.player_name == message.player_name && m.message == message.message
                                    );
                                    
                                    if !already_exists {
                                        room.add_chat_message(message.clone());
                                        
                                        // Update has_guessed flag and points if correct guess
                                        if message.is_correct_guess {
                                            for player in &mut room.players {
                                                if player.name == message.player_name {
                                                    player.has_guessed = true;
                                                    player.score += message.points_awarded;
                                                    eprintln!("[STREAM_UPDATE] Player '{}' score updated: +{} points", player.name, message.points_awarded);
                                                    break;
                                                }
                                            }
                                        }
                                        
                                        self.state.room.set(Some(room));
                                        eprintln!("[STREAM_UPDATE] Chat message processed and added to local state");
                                    } else {
                                        eprintln!("[STREAM_UPDATE] Chat message already exists - skipping duplicate");
                                    }
                                }
                                
                                // THEN re-emit if we're host and event came from drawer
                                if is_host && stream_update.chain_id != current_chain {
                                    eprintln!("[STREAM_UPDATE] Host re-emitting ChatMessage from drawer {:?} to all players", stream_update.chain_id);
                                    if let Some(room) = self.state.room.get() {
                                        self.runtime.emit(format!("game_events_{}", room.room_id).into(), &doodle_game::DoodleEvent::ChatMessage { 
                                            message: message.clone() 
                                        });
                                    }
                                }
                            }
                            
                            doodle_game::DoodleEvent::RoundEnded { scores: _, timestamp } => {
                                eprintln!("[STREAM_UPDATE] Round ended at {}", timestamp);
                                if let Some(mut room) = self.state.room.get().clone() {
                                    room.advance_to_next_round(timestamp.clone());
                                    self.state.room.set(Some(room));
                                    eprintln!("[STREAM_UPDATE] Round advanced, waiting for drawer selection");
                                }
                            }
                            
                            doodle_game::DoodleEvent::GameEnded { final_scores: _, timestamp } => {
                                eprintln!("[STREAM_UPDATE] Game ended at {}", timestamp);
                                if let Some(mut room) = self.state.room.get().clone() {
                                    room.game_state = GameState::GameEnded;
                                    self.state.room.set(Some(room));
                                    eprintln!("[STREAM_UPDATE] Game ended in local room state");
                                }
                            }
                            
                            doodle_game::DoodleEvent::MatchEnded { timestamp } => {
                                eprintln!("[STREAM_UPDATE] Match ended at {}", timestamp);
                                // Room will be deleted via RoomDeleted message
                            }
                        }
                    }
                }
            }
        }
    }

    async fn store(mut self) {
        let _ = self.state.save().await;
    }
}

#[ComplexObject]
impl DoodleGameState {}
