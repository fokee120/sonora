import React from 'react';
import {ArrowLeft} from 'lucide-react';
import {useApp} from '../context/AppContext.js';
import {SocialProfile} from '../components/settings/SocialProfile.js';
export function ProfileView({id}:{id?:string}){const {navigate}=useApp();return <div className="page-stack profile-page"><header><button className="player-icon outlined-icon" aria-label="Back" onClick={()=>navigate({type:id?'search':'home'})}><ArrowLeft size={22}/></button></header><SocialProfile initialProfileId={id}/></div>;}
