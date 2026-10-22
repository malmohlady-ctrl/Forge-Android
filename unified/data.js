/* FIT HQ workout content, ported from Malcolm's existing apps:
   Couch to 5K plan, Home Corner dumbbell circuit + boxing combos + core
   finisher, Namastay Home yoga routines. */
"use strict";
const C25K_PLANS = [
{title:"Week 1",desc:"Build the habit with short, gentle jogs.",run:60,walk:90,reps:8,extra:0},
{title:"Week 2",desc:"Let the running intervals grow a little.",run:90,walk:120,reps:6,extra:0},
{title:"Week 3",desc:"Introduce longer jogs with recovery walks.",run:90,walk:90,reps:2,extra:180},
{title:"Week 4",desc:"A steady step toward longer continuous running.",run:180,walk:90,reps:3,extra:180},
{title:"Week 5",desc:"Build confidence with a longer run interval.",run:300,walk:150,reps:3,extra:300},
{title:"Week 6",desc:"Work toward longer stretches without stopping.",run:480,walk:180,reps:2,extra:600},
{title:"Week 7",desc:"Practice continuous easy running.",run:1200,walk:0,reps:1,extra:0},
{title:"Week 8",desc:"Extend the continuous run gently.",run:1500,walk:0,reps:1,extra:0},
{title:"Week 9",desc:"Finish with a continuous 30-minute easy run.",run:1800,walk:0,reps:1,extra:0}
]
const DUMBBELL=[
"3X Hammer Curl + 3X Press","Bent Over Back Rows","Renegade Row","Close Grip to Rotational ISO Chest Press",
"Kneeling Front Raise","Kneeling Inward Curls","L-Sit Leg Raise","Alt In and Out","Gorilla Rows",
"Front to Side Raise (Right)","Front to Side Raise (Left)","Good Morning","Alt Upright Rows","Chest Press + Opener",
"ISO to Double Chest Fly","Triceps to Tate Press","Kneeling Curl to Press to Extension","Pullover to Reverse Crunch",
"Sit-Up to DB Tap","Push-Up to Ranger to Curls","Bent Over Twist Row (Right)","Bent Over Twist Row (Left)",
"Single to Double Triceps Kickback","3X Twist Curl + Hold","Weighted Crunches","Skull Crusher + Flutters",
"Concentration Curl (Right)","Concentration Curl (Left)","Decline Reverse Press"];
const CORE=[["Plank",40],["Dead Bug",40],["Russian Twists",40],["Mountain Climbers",40],["Leg Raises",40],["Bicycle Crunches",40],["Side Plank — Left",40],["Side Plank — Right",40]];
const R1=["1-2","1-1-2","2-3-2","1-2-3-2"],R2=["1-2-3","3-2-3","1-3-2","2-4-2"],R3=["1-6-3-2","5-2-3","2-5-2-3","1-2-5-2"];
const P=(name,sanskrit,secs,cue,mid)=>({type:"pose",name,sanskrit:sanskrit||"",secs,cue,mid:mid||"Inhale\u2026 and exhale."});
const B=(name,secs,cue,mid)=>({type:"breath",name,secs,cue,mid:mid||"Inhale\u2026 and exhale."});
const T=(cue)=>({type:"rest",name:"Rest",secs:10,cue:cue||"Move gently into the next pose."});
const YOGA_ROUTINES = [
{id:"back",title:"Back Care Basics",tag:"~10 min",desc:"A slow, gentle back routine — the one you know. Move with your breath, and never force a stretch.",segs:[
 B("Centering Breath",45,"Sit comfortably, hands resting easy. Close your eyes if you like. Breathe in slowly through your nose… and let it all go.","Let your shoulders drop away from your ears."),
 P("Cat-Cow Flow","Marjaryasana – Bitilasana",120,"On all fours, hands under shoulders. Inhale, drop your belly and lift your gaze. Exhale, round your spine like a cat. Let your breath lead the movement.","Keep flowing gently. Inhale open, exhale round."),
 T(),
 P("Child's Pose","Balasana",120,"Knees wide, big toes touching. Fold forward and rest your forehead on the mat. Let your arms reach forward, or rest them alongside you.","Breathe into your back. Let gravity do the work."),
 T(),
 P("Sphinx Pose","Salamba Bhujangasana",90,"Lie on your belly, forearms on the mat, elbows under your shoulders. Press gently into your forearms and lift your chest. Keep your neck long and easy.","Inhale… and exhale. Let your shoulders soften."),
 T(),
 P("Supine Twist — Left","Supta Matsyendrasana",75,"Lie on your back, knees stacked over your hips, arms open in a T. Let your knees fall to the left. Keep both shoulders resting on the mat.","Breathe into the twist. No forcing."),
 T("Switch sides when you're ready."),
 P("Supine Twist — Right","Supta Matsyendrasana",75,"Let your knees fall to the right. Relax your shoulders into the mat.","One more easy breath here."),
 T(),
 B("Closing Breath",45,"Lie still. Notice how your back feels now compared to when you started. Breathe easy.","Well done. Rest here as long as you like.")
]},
{id:"foundations",title:"Foundations",tag:"~8 min",desc:"The easiest session in the app — for low-energy days, or when you're brand new. Everything is done slowly, much of it lying down.",segs:[
 B("Centering Breath",60,"Sit tall and comfortable. Close your eyes. Take a slow breath in… and a slow breath out. Arrive on your mat.","There's nowhere else to be right now."),
 P("Seated Cat-Cow","Marjaryasana – Bitilasana",90,"Stay seated. Inhale, arch gently and open your chest. Exhale, round forward and tuck your chin. Easy and slow.","Let the movement follow your breath."),
 T(),
 P("Child's Pose","Balasana",120,"Knees wide, big toes touching. Fold forward, forehead to the mat. This is a resting pose — settle in and stay a while.","With every exhale, sink a little heavier."),
 T(),
 P("Knees-to-Chest","Apanasana",90,"Lie on your back and hug your knees in toward your chest. Rock gently side to side, massaging your lower back into the mat.","Breathe easy. Let your back release."),
 T(),
 B("Savasana",120,"Lie flat, arms by your sides, palms facing up. Close your eyes. Let your whole body feel heavy and still.","You don't need to do anything at all.")
]},
{id:"reset",title:"Full Reset",tag:"~15 min",desc:"A gentle full-body flow to unwind the whole day — neck, spine, hips, legs, and a long rest at the end.",segs:[
 B("Centering Breath",45,"Stand or sit tall. Close your eyes. Take three slow breaths to arrive.","Feel your feet on the ground beneath you."),
 P("Neck Rolls",null,60,"Drop your chin to your chest. Slowly roll your right ear toward your right shoulder, then back around. Keep it gentle, no forcing.","Now change direction. Nice and slow."),
 T(),
 P("Cat-Cow Flow","Marjaryasana – Bitilasana",60,"On all fours. Inhale, belly drops, gaze lifts. Exhale, spine rounds. Warm up the whole back.","Smooth and unhurried."),
 T(),
 P("Downward Dog","Adho Mukha Svanasana",45,"Tuck your toes and lift your hips high. Pedal your feet, bending one knee then the other. Let your head hang heavy.","Press the mat away. Let your heels reach down."),
 T(),
 P("Low Lunge — Left",null,45,"Step your left foot forward between your hands. Sink your hips low. Hands can rest on the floor or on your front thigh.","Breathe into the front of your right hip."),
 T("Switch sides when you're ready."),
 P("Low Lunge — Right",null,45,"Right foot forward now. Sink in and breathe. Same ease on this side.","Steady. You're doing well."),
 T(),
 P("Warrior II — Left","Virabhadrasana II",45,"From your lunge, rise up tall. Front knee over your ankle, arms reach wide, gaze over your left fingertips. Strong legs, easy shoulders.","Root down through your feet."),
 T("Switch sides when you're ready."),
 P("Warrior II — Right","Virabhadrasana II",45,"Right side now. Knee over ankle, arms wide, gaze over your right fingertips.","Breathe wide into your chest."),
 T(),
 P("Tree — Left","Vrksasana",30,"Stand tall. Rest your left foot against your inner right leg — ankle, calf, or thigh, never on the knee. Hands at your heart, or overhead.","Find one still point to rest your eyes on."),
 T("Switch sides when you're ready."),
 P("Tree — Right","Vrksasana",30,"Right foot up. Wobbling is fine — catching yourself is the practice.","One more steady breath."),
 T(),
 P("Seated Forward Fold","Paschimottanasana",60,"Sit with your legs extended. Hinge forward from your hips, reaching toward your feet. Bend your knees as much as you like.","Let your head hang. No pulling, just folding."),
 T(),
 P("Supine Twist — Left","Supta Matsyendrasana",45,"Lie back, knees over hips, arms in a T. Let your knees fall to the left, shoulders staying down.","Twist a little deeper with your exhale."),
 T("Switch sides when you're ready."),
 P("Supine Twist — Right","Supta Matsyendrasana",45,"Knees fall to the right. Let everything soften into the mat.","Almost done. Breathe easy."),
 T(),
 B("Savasana",180,"Lie flat, arms by your sides, palms up. Close your eyes. This is the most important pose — complete rest.","Let go of the day. Just breathe.")
]}
];
