export interface IRoom {
    id: string;
    isMainRoom?: boolean;
    jid: string;
    name: string;
    participants: {
        [jid: string]: {
            displayName: string;
            jid: string;
            role: string;
        };
    };
}

export interface IRooms {
    [jid: string]: IRoom;
}

export interface IRoomInfo {
    id: string;
    isMainRoom: boolean;
    jid: string;
    participants: IRoomInfoParticipant[];
}

export interface IRoomsInfo {
    rooms: IRoomInfo[];
}

export interface IRoomInfoParticipant {
    avatarUrl: string;
    displayName: string;
    id: string;
    jid: string;
    role: string;
}

/**
 * Pre-assignment specification: a list of rooms with the participants that
 * should land in each. Identifiers are matched against participant id,
 * email, or displayName (in that order). Surfaced via the
 * `?breakout-assignments=<base64-json>` deeplink param or the
 * `apply-breakout-assignments` iframe API command.
 */
export interface IBreakoutAssignmentRoom {
    name: string;
    participants: string[];
}

export interface IBreakoutAssignments {
    rooms: IBreakoutAssignmentRoom[];
}
