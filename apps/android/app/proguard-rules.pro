# kotlinx.serialization — keep generated serializers reachable via reflection-free lookup.
-keepattributes RuntimeVisibleAnnotations,AnnotationDefault
-keepclassmembers class com.loonext.android.** {
    *** Companion;
}
-if @kotlinx.serialization.Serializable class **
-keepclassmembers class <1> {
    static <1>$Companion Companion;
}
-if @kotlinx.serialization.Serializable class ** {
    static **$* *;
}
-keepclassmembers class <2>$<3> {
    kotlinx.serialization.KSerializer serializer(...);
}
