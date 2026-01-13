import React from 'react';
import { User } from 'lucide-react';

export default function PatientVisual({ image, context, caseData }) {
    const config = caseData?.config || {};
    const demo = config.demographics || {};
    const patientName = config.patient_name || caseData?.name;

    return (
        <div className="h-full flex flex-col bg-neutral-900 overflow-hidden relative">
            {/* Full Height Image Area */}
            <div className="absolute inset-0 bg-black/50">
                {image ? (
                    <img src={image} alt="Patient" className="w-full h-full object-cover opacity-80" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-neutral-700">
                        <User className="w-24 h-24" />
                    </div>
                )}
            </div>

            {/* Floating Context Bubble (Brief) - Only if exists */}
            {false && (context || patientName) && (
                <div className="absolute bottom-6 left-6 max-w-[80%] z-10">
                    <div className="bg-black/60 backdrop-blur-md border border-white/10 p-4 rounded-xl text-white shadow-2xl animate-in fade-in slide-in-from-bottom-4">
                        {patientName && (
                            <div className="mb-2">
                                <span className="text-xl font-bold text-white tracking-tight">{patientName}</span>
                                {demo.age && (
                                    <span className="ml-2 text-sm text-neutral-400 font-medium">
                                        {demo.age}y {demo.gender}
                                    </span>
                                )}
                            </div>
                        )}
                        {context && (
                            <p className="font-light text-sm text-neutral-300 leading-relaxed italic border-l-2 border-purple-500/50 pl-3">
                                "{context}"
                            </p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
